package app.nexus.localaispike

import android.app.Activity
import android.os.Bundle
import android.content.Intent
import android.net.Uri
import android.widget.*
import com.google.ai.edge.litertlm.Engine
import com.google.ai.edge.litertlm.EngineConfig
import kotlinx.coroutines.*
import kotlinx.coroutines.flow.collect
import java.io.File
import java.security.MessageDigest

/**
 * Standalone, local-only model loading probe. No network permission and no device-action executor.
 * Runs separately from the signed Nexus Phone APK, leaving its existing bridge untouched.
 */
class MainActivity : Activity() {
 private val scope = CoroutineScope(SupervisorJob() + Dispatchers.Main)
 private lateinit var status: TextView
 private lateinit var output: TextView
 private lateinit var prompt: EditText
 private lateinit var runButton: Button
 private var modelFile: File? = null
 private var busy = false
 private var lastChecksum = ""
 private val maxModelBytes = 1_500_000_000L
 private val chooserRequest = 101

 override fun onCreate(savedInstanceState: Bundle?) {
  super.onCreate(savedInstanceState)
  val root = LinearLayout(this).apply {
   orientation = LinearLayout.VERTICAL
   setPadding(28, 28, 28, 28)
  }
  val title = TextView(this).apply { text = "Nexus Local AI Lab"; textSize = 22f }
  val choose = Button(this).apply { text = "Import a .litertlm model" }
  status = TextView(this).apply { text = "No model imported. Local-only test; no Nexus connection." }
  prompt = EditText(this).apply {
   hint = "Enter a short local test prompt"
   setSingleLine(false)
   minLines = 2
   setText("Respond with one short sentence: offline inference is working.")
  }
  runButton = Button(this).apply { text = "Run local model"; isEnabled = false }
  output = TextView(this).apply { text = "The response will appear here."; setTextIsSelectable(true) }
  root.addView(title)
  root.addView(choose)
  root.addView(status)
  root.addView(prompt)
  root.addView(runButton)
  root.addView(ScrollView(this).apply { addView(output) })
  setContentView(root)
  choose.setOnClickListener {
   if (busy) return@setOnClickListener
   startActivityForResult(Intent(Intent.ACTION_OPEN_DOCUMENT).apply {
    addCategory(Intent.CATEGORY_OPENABLE)
    type = "application/octet-stream"
    putExtra(Intent.EXTRA_MIME_TYPES, arrayOf("application/octet-stream", "application/x-binary"))
   }, chooserRequest)
  }
  runButton.setOnClickListener { infer() }
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
   return target
  } finally { temp.delete() }
 }

 private fun infer() {
  val file = modelFile ?: return
  val text = prompt.text.toString()
  if (text.isBlank() || text.length > 2000) { status.text = "Prompt must be 1–2000 characters."; return }
  scope.launch {
   setBusy(true)
   output.text = ""
   status.text = "Loading model locally…"
   val started = System.nanoTime()
   try {
    val result = withContext(Dispatchers.IO) {
     val parts = StringBuilder()
     Engine(EngineConfig(modelPath = file.absolutePath)).use { engine ->
      engine.initialize()
      engine.createConversation().use { conversation ->
       conversation.sendMessageAsync(text).collect { part -> parts.append(part) }
      }
     }
     parts.toString()
    }
    output.text = result
    status.text = "Local inference completed in ${(System.nanoTime() - started) / 1_000_000} ms."
   } catch (e: Throwable) {
    status.text = "Runtime error: ${e.javaClass.simpleName}: ${e.message}"
   } finally { setBusy(false) }
  }
 }

 private fun setBusy(value: Boolean) {
  busy = value
  runButton.isEnabled = !value && modelFile != null
  prompt.isEnabled = !value
 }
 override fun onDestroy() { scope.cancel(); super.onDestroy() }
}
