package app.nexus.phone;

import java.util.Collections;
import java.util.LinkedHashMap;
import java.util.Map;

/**
 * Translates FunctionGemma's native function-call text into the narrow JSON shape that
 * {@link LocalActionGate} validates. Model output is untrusted: this class is deliberately strict,
 * rejects anything it does not fully understand, and executes nothing.
 *
 * Accepted input (whitespace and a trailing end-of-turn marker tolerated):
 *   &lt;start_function_call&gt;call:NAME{key:&lt;escape&gt;value&lt;escape&gt;,...}&lt;end_function_call&gt;
 */
public final class LocalActionCall {
 private static final String START = "<start_function_call>";
 private static final String END = "<end_function_call>";
 private static final String ESC = "<escape>";
 private static final int MAX_LENGTH = 2048;
 private static final int MAX_VALUE = 200;
 private static final String[] TRAILING = {"<end_of_turn>", "<start_function_response>"};

 /** Model function name -> Nexus action name. Keep in step with LocalActionGate's allowlist. */
 private static final Map<String, String> ACTIONS = new LinkedHashMap<>();
 static {
  ACTIONS.put("turn_on_flashlight", "flashlight_on");
  ACTIONS.put("turn_off_flashlight", "flashlight_off");
  ACTIONS.put("open_wifi_settings", "open_wifi_settings");
  ACTIONS.put("show_map", "show_map");
  ACTIONS.put("create_contact", "create_contact");
  ACTIONS.put("send_email", "send_email");
  ACTIONS.put("create_calendar_event", "create_calendar_event");
 }

 private LocalActionCall() {}

 public static Map<String, String> actions() { return Collections.unmodifiableMap(ACTIONS); }

 /** @return JSON text such as {"action":"flashlight_on","arguments":{}} ready for LocalActionGate.validate. */
 public static String toActionJson(String raw) {
  if (raw == null || raw.length() > MAX_LENGTH) throw bad("Invalid model output length.");
  String s = raw.trim();
  boolean stripped = true;
  while (stripped) {
   stripped = false;
   for (String t : TRAILING) {
    if (s.endsWith(t)) { s = s.substring(0, s.length() - t.length()).trim(); stripped = true; }
   }
  }
  if (!s.startsWith(START) || !s.endsWith(END)) throw bad("Not a single function call.");
  String body = s.substring(START.length(), s.length() - END.length());
  if (body.contains(START) || body.contains(END)) throw bad("More than one function call.");
  if (!body.startsWith("call:")) throw bad("Missing call prefix.");
  int open = body.indexOf('{');
  if (open < 0 || !body.endsWith("}")) throw bad("Malformed call body.");
  String name = body.substring(5, open);
  if (!isName(name)) throw bad("Invalid function name.");
  String action = ACTIONS.get(name);
  if (action == null) throw bad("Unsupported function.");
  String argText = body.substring(open + 1, body.length() - 1);
  Map<String, String> args = parseArgs(argText);
  StringBuilder json = new StringBuilder();
  json.append("{\"action\":\"").append(action).append("\",\"arguments\":{");
  boolean first = true;
  for (Map.Entry<String, String> e : args.entrySet()) {
   if (!first) json.append(',');
   first = false;
   json.append('"').append(e.getKey()).append("\":\"").append(escape(e.getValue())).append('"');
  }
  return json.append("}}").toString();
 }

 private static Map<String, String> parseArgs(String text) {
  Map<String, String> out = new LinkedHashMap<>();
  int i = 0;
  int n = text.length();
  if (n == 0) return out;
  while (true) {
   int colon = text.indexOf(':', i);
   if (colon < 0) throw bad("Malformed arguments.");
   String key = text.substring(i, colon);
   if (!isName(key)) throw bad("Invalid argument name.");
   if (out.containsKey(key)) throw bad("Duplicate argument.");
   if (!text.startsWith(ESC, colon + 1)) throw bad("Only string arguments are supported.");
   int vs = colon + 1 + ESC.length();
   int ve = text.indexOf(ESC, vs);
   if (ve < 0) throw bad("Unterminated argument value.");
   String value = text.substring(vs, ve);
   if (value.length() > MAX_VALUE) throw bad("Argument value too long.");
   for (int k = 0; k < value.length(); k++) {
    if (value.charAt(k) < 0x20) throw bad("Control character in argument.");
   }
   if (value.contains("<") || value.contains(">")) throw bad("Markup in argument.");
   out.put(key, value);
   i = ve + ESC.length();
   if (i == n) return out;
   if (text.charAt(i) != ',') throw bad("Unexpected text after argument.");
   i++;
   if (i >= n) throw bad("Trailing comma.");
  }
 }

 private static boolean isName(String s) {
  if (s.isEmpty() || s.length() > 40) return false;
  for (int i = 0; i < s.length(); i++) {
   char c = s.charAt(i);
   if (!((c >= 'a' && c <= 'z') || c == '_')) return false;
  }
  return true;
 }

 private static String escape(String v) {
  StringBuilder b = new StringBuilder();
  for (int i = 0; i < v.length(); i++) {
   char c = v.charAt(i);
   if (c == '"' || c == '\\') b.append('\\');
   b.append(c);
  }
  return b.toString();
 }

 private static IllegalArgumentException bad(String m) { return new IllegalArgumentException(m); }
}
