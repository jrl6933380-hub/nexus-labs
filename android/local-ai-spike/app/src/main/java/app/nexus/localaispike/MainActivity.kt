package app.nexus.localaispike

import android.app.Activity
import android.content.Context
import android.content.Intent
import android.graphics.Typeface
import android.net.Uri
import android.os.Bundle
import android.view.inputmethod.InputMethodManager
import android.widget.*
import app.nexus.phone.LocalActionBridge
import com.google.ai.edge.litertlm.Engine
import com.google.ai.edge.litertlm.EngineConfig
import kotlinx.coroutines.*
import kotlinx.coroutines.flow.collect
import org.json.JSONObject
import java.io.File
import java.security.MessageDigest

/**
 * Standalone, local-only action console. No network permission and no device-action executor.
 * Each request runs FunctionGemma on this phone, parses its function call, and checks it with the same
 * LocalActionGate the Nexus Phone app uses. The result is only displayed ("Would run: ..."); nothing is executed.
 */
class MainActivity : Activity() {
 private val scope = CoroutineScope(SupervisorJob() + Dispatchers.Main)
 private lateinit var status: TextView
 private lateinit var resultTitle: TextView
 private lateinit var resultDetail: TextView
 private lateinit var request: EditText
 private lateinit var askButton: Button
 private lateinit var actionButtons: List<Button>
 private lateinit var chooseButton: Button
 private var modelFile: File? = null
 private var engine: Engine? = null
 private var busy = false
 private var lastChecksum = ""
 private val maxModelBytes = 1_500_000_000L
 private val chooserRequest = 101

 private fun dp(v: Int) = (v * resources.displayMetrics.density).toInt()

 override fun onCreate(savedInstanceState: Bundle?) {
  super.onCreate(savedInstanceState)
  val root = LinearLayout(this).apply {
   orientation = LinearLayout.VERTICAL
   setPadding(dp(16), dp(16), dp(16), dp(16))
  }
  val title = TextView(this).apply { text = "Nexus Local AI"; textSize = 24f; setTypeface(typeface, Typeface.BOLD) }
  val subtitle = TextView(this).apply {
   text = "Runs on this phone. No internet. Nothing is executed yet."
   textSize = 13f
  }
  status = TextView(this).apply { textSize = 12f; setPadding(0, dp(8), 0, dp(8)) }
  chooseButton = Button(this).apply { text = "Import a .litertlm model" }

  val flashOn = Button(this).apply { text = "Flashlight on" }
  val flashOff = Button(this).apply { text = "Flashlight off" }
  val wifi = Button(this).apply { text = "Wi-Fi settings" }
  val map = Button(this).apply { text = "Show map" }

  request = EditText(this).apply {
   hint = "Type a request, or a place for Show map"
   setSingleLine(true)
   maxLines = 1
  }
  askButton = Button(this).apply { text = "Ask" }
  actionButtons = listOf(flashOn, flashOff, wifi, map, askButton)

  resultTitle = TextView(this).apply {
   text = "Pick a button or type a request."
   textSize = 20f
   setTypeface(typeface, Typeface.BOLD)
   setPadding(0, dp(16), 0, dp(4))
  }
  resultDetail = TextView(this).apply { textSize = 12f; setTextIsSelectable(true) }

  root.addView(title)
  root.addView(subtitle)
  root.addView(status)
  root.addView(row(flashOn, flashOff))
  root.addView(row(wifi, map))
  root.addView(request)
  root.addView(askButton)
  root.addView(resultTitle)
  root.addView(resultDetail)
  root.addView(chooseButton)
  setContentView(ScrollView(this).apply { isFillViewport = true; addView(root) })

  restoreModel()
  setBusy(false)

  chooseButton.setOnClickListener {
   if (busy) return@setOnClickListener
   startActivityForResult(Intent(Intent.ACTION_OPEN_DOCUMENT).apply {
    addCategory(Intent.CATEGORY_OPENABLE)
    type = "application/octet-stream"
    putExtra(Intent.EXTRA_MIME_TYPES, arrayOf("application/octet-stream", "application/x-binary"))
   }, chooserRequest)
  }
  flashOn.setOnClickListener { ask("Turn on the flashlight") }
  flashOff.setOnClickListener { ask("Turn off the flashlight") }
  wifi.setOnClickListener { ask("Open Wi-Fi settings") }
  map.setOnClickListener {
   val place = request.text.toString().trim()
   if (place.isEmpty()) showResult("Type a place first", "Enter a place or address in the box, then tap Show map.")
   else ask("Show $place on the map")
  }
  askButton.setOnClickListener { ask(request.text.toString()) }
 }

 private fun row(a: Button, b: Button) = LinearLayout(this).apply {
  orientation = LinearLayout.HORIZONTAL
  addView(a, LinearLayout.LayoutParams(0, LinearLayout.LayoutParams.WRAP_CONTENT, 1f))
  addView(b, LinearLayout.LayoutParams(0, LinearLayout.LayoutParams.WRAP_CONTENT, 1f))
 }

 private fun restoreModel() {
  val existing = File(filesDir, "model.litertlm")
  if (existing.isFile && existing.length() > 0) {
   modelFile = existing
   val saved = File(filesDir, "model.sha256")
   lastChecksum = if (saved.isFile) saved.readText().trim() else "unknown"
   status.text = "Model ready: ${existing.length() / (1024 * 1024)} MiB\nSHA-256: $lastChecksum"
  } else {
   status.text = "No model yet. Tap Import and pick the FunctionGemma .litertlm file."
  }
 }

 @Deprecated("Android document result callback")
 override fun onActivityResult(requestCode: Int, resultCode: Int, data: Intent?) {
  super.onActivityResult(requestCode, resultCode, data)
  if (requestCode != chooserRequest || resultCode != RESULT_OK) return
  val uri = data?.data ?: return
  scope.launch {
   setBusy(true)
   status.text = "Copying model into private app storage…"
   try {
    withContext(Dispatchers.IO) { engine?.close(); engine = null }
    modelFile = withContext(Dispatchers.IO) { copyModel(uri) }
    status.text = "Model imported: ${modelFile!!.length() / (1024 * 1024)} MiB\nSHA-256: $lastChecksum"
   } catch (e: Exception) {
    modelFile = null
    status.text = "Import failed: ${e.message}"
   } finally { setBusy(false) }
  }
 }

 private fun copyModel(uri: Uri): File {
  val target = File(filesDir, "model.litertlm")
  val temp = File(filesDir, "model.pending")
  try {
   val digest = MessageDigest.getInstance("SHA-256")
   var total = 0L
   contentResolver.openInputStream(uri).use { input ->
    requireNotNull(input) { "Cannot open selected model" }
    temp.outputStream().use { dest ->
     val buf = ByteArray(1 shl 16)
     while (true) {
      val n = input.read(buf)
      if (n < 0) break
      total += n
      // Enforce the cap while copying so an oversized file never fills storage.
      require(total <= maxModelBytes) { "Model too large for this TCL test (1.5 GB cap)." }
      digest.update(buf, 0, n)
      dest.write(buf, 0, n)
     }
    }
   }
   require(total > 0) { "Selected file is empty" }
   lastChecksum = digest.digest().joinToString("") { "%02x".format(it) }
   if (target.exists()) target.delete()
   check(temp.renameTo(target)) { "Could not commit model file" }
   File(filesDir, "model.sha256").writeText(lastChecksum)
   return target
  } finally { temp.delete() }
 }

 private fun showResult(title: String, detail: String) {
  resultTitle.text = title
  resultDetail.text = detail
 }

 private fun ask(text: String) {
  if (busy) return
  val file = modelFile ?: run { showResult("No model yet", "Tap Import a .litertlm model first."); return }
  (getSystemService(Context.INPUT_METHOD_SERVICE) as InputMethodManager).hideSoftInputFromWindow(request.windowToken, 0)
  val prompt = try {
   LocalActionBridge.buildPrompt(text)
  } catch (e: IllegalArgumentException) {
   showResult("Can't use that request", e.message ?: "Invalid request.")
   return
  }
  scope.launch {
   setBusy(true)
   val cold = engine == null
   showResult("Thinking…", if (cold) "Loading the model for the first request; this takes about 15 seconds." else "")
   val started = System.nanoTime()
   try {
    val raw = withContext(Dispatchers.IO) {
     val e = engine ?: Engine(EngineConfig(modelPath = file.absolutePath)).also { created ->
      try { created.initialize() } catch (t: Throwable) { created.close(); throw t }
      engine = created
     }
     val parts = StringBuilder()
     e.createConversation().use { conversation ->
      conversation.sendMessageAsync(prompt).collect { part -> parts.append(part) }
     }
     parts.toString()
    }
    val ms = (System.nanoTime() - started) / 1_000_000
    status.text = "Model ready · last request ${ms} ms${if (cold) " (includes model load)" else ""}"
    judge(raw)
   } catch (e: Throwable) {
    engine?.let { runCatching { it.close() } }
    engine = null
    showResult("Model error", "${e.javaClass.simpleName}: ${e.message}")
   } finally { setBusy(false) }
  }
 }

 /** Runs the model's text through the parser and the real safety gate; displays the verdict only. */
 private fun judge(raw: String) {
  val shown = "Model output:\n" + raw.trim()
  try {
   val verdict = JSONObject(LocalActionBridge.validate(raw))
   val args = verdict.getJSONObject("arguments")
   val label = when (val action = verdict.getString("action")) {
    "flashlight_on" -> "Turn the flashlight on"
    "flashlight_off" -> "Turn the flashlight off"
    "open_wifi_settings" -> "Open Wi-Fi settings"
    "show_map" -> "Show \"${args.getString("query")}\" on the map"
    // Contact, email and calendar actions: show every validated field so the test is easy to read.
    else -> "$action $args"
   }
   showResult("✔ Would run: $label", "Passed the safety gate. Nothing was executed.\n\n$shown")
  } catch (e: Exception) {
   val replied = !raw.contains("<start_function_call>")
   showResult(
    if (replied) "No action: the model replied with text" else "✖ Blocked by the safety check",
    (if (replied) "Try a direct command such as \"Turn on the flashlight\".\n\n" else "${e.message}\n\n") + shown
   )
  }
 }

 private fun setBusy(value: Boolean) {
  busy = value
  val ready = !value && modelFile != null
  actionButtons.forEach { it.isEnabled = ready }
  chooseButton.isEnabled = !value
  request.isEnabled = !value
 }

 override fun onDestroy() {
  scope.cancel()
  runCatching { engine?.close() }
  engine = null
  super.onDestroy()
 }
}
