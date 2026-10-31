package app.nexus.phone;

/**
 * Builds the FunctionGemma prompt from the Nexus local-action allowlist. The user's request is
 * untrusted text placed inside a turn, so characters that could forge control tokens are rejected.
 * This class only builds text; it loads no model and executes nothing.
 * The declared functions are the ones FunctionGemma's mobile-actions model was fine-tuned on, so it knows them best.
 */
public final class LocalActionPrompt {
 private static final int MAX_REQUEST = 300;
 private static final String E = "<escape>";

 private static final String DECLARATIONS =
  decl("turn_on_flashlight", "Turns the flashlight on")
  + decl("turn_off_flashlight", "Turns the flashlight off")
  + decl("open_wifi_settings", "Opens the Wi-Fi settings screen")
  + decl("show_map", "Shows a place on a map", p("query", "Place or address to show", true))
  + decl("create_contact", "Creates a contact",
   p("first_name", "First name", true), p("last_name", "Last name", false),
   p("phone_number", "Phone number", false), p("email", "Email address", false))
  + decl("send_email", "Drafts an email",
   p("to", "Recipient email address", true), p("subject", "Subject line", false), p("body", "Message text", false))
  + decl("create_calendar_event", "Creates a calendar event",
   p("title", "Event title", true), p("datetime", "Start date and time as YYYY-MM-DDTHH:MM:SS", true));

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

 private static String[] p(String name, String description, boolean required) {
  return new String[]{name, description, required ? "1" : "0"};
 }

 private static String decl(String name, String description, String[]... params) {
  String body;
  if (params.length == 0) {
   body = "parameters:{type:" + E + "OBJECT" + E + "}";
  } else {
   StringBuilder props = new StringBuilder();
   StringBuilder required = new StringBuilder();
   for (String[] param : params) {
    if (props.length() > 0) props.append(',');
    props.append(param[0]).append(":{description:").append(E).append(param[1]).append(E)
     .append(",type:").append(E).append("STRING").append(E).append('}');
    if ("1".equals(param[2])) {
     if (required.length() > 0) required.append(',');
     required.append(E).append(param[0]).append(E);
    }
   }
   body = "parameters:{properties:{" + props + "}"
    + (required.length() > 0 ? ",required:[" + required + "]" : "")
    + ",type:" + E + "OBJECT" + E + "}";
  }
  return "<start_function_declaration>declaration:" + name + "{description:" + E + description + E + "," + body
   + "}<end_function_declaration>";
 }
}
