package app.nexus.phone;

/**
 * Builds the FunctionGemma prompt from the Nexus local-action allowlist. The user's request is
 * untrusted text placed inside a turn, so characters that could forge control tokens are rejected.
 * This class only builds text; it loads no model and executes nothing.
 */
public final class LocalActionPrompt {
 private static final int MAX_REQUEST = 300;
 private static final String E = "<escape>";

 private static final String DECLARATIONS =
  decl("turn_on_flashlight", "Turns the flashlight on", null)
  + decl("turn_off_flashlight", "Turns the flashlight off", null)
  + decl("open_wifi_settings", "Opens the Wi-Fi settings screen", null)
  + decl("show_map", "Shows a place on a map", "query");

 private LocalActionPrompt() {}

 public static String build(String userRequest) {
  if (userRequest == null) throw new IllegalArgumentException("Empty request.");
  String request = userRequest.trim();
  if (request.isEmpty() || request.length() > MAX_REQUEST) throw new IllegalArgumentException("Request must be 1-" + MAX_REQUEST + " characters.");
  for (int i = 0; i < request.length(); i++) {
   char c = request.charAt(i);
   if (c < 0x20 || c == '<' || c == '>') throw new IllegalArgumentException("Request contains unsupported characters.");
  }
  return "<start_of_turn>developer\n"
   + "You are a model that can do function calling with the following functions"
   + DECLARATIONS
   + "<end_of_turn>\n"
   + "<start_of_turn>user\n" + request + "<end_of_turn>\n"
   + "<start_of_turn>model\n";
 }

 private static String decl(String name, String description, String stringParam) {
  String params;
  if (stringParam == null) {
   params = "parameters:{type:" + E + "OBJECT" + E + "}";
  } else {
   params = "parameters:{properties:{" + stringParam + ":{description:" + E + "Place or address to show" + E
    + ",type:" + E + "STRING" + E + "}},required:[" + E + stringParam + E + "],type:" + E + "OBJECT" + E + "}";
  }
  return "<start_function_declaration>declaration:" + name + "{description:" + E + description + E + "," + params
   + "}<end_function_declaration>";
 }
}
