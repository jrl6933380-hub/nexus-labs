import app.nexus.phone.LocalActionCall;
import app.nexus.phone.LocalActionPrompt;

/** Plain-main test (same style as PlaygroundPolicyTest): no JUnit, no org.json, no Android. */
public final class LocalActionCallTest {
 static void check(boolean value, String what) { if (!value) throw new AssertionError(what); }

 static void eq(String actual, String expected) {
  if (!expected.equals(actual)) throw new AssertionError("Expected " + expected + " but got " + actual);
 }

 static void rejects(String raw) {
  try {
   String out = LocalActionCall.toActionJson(raw);
   throw new AssertionError("Accepted: " + raw + " -> " + out);
  } catch (IllegalArgumentException expected) { }
 }

 static String call(String body) { return "<start_function_call>call:" + body + "<end_function_call>"; }

 public static void main(String[] args) {
  eq(LocalActionCall.toActionJson(call("turn_on_flashlight{}")), "{\"action\":\"flashlight_on\",\"arguments\":{}}");
  eq(LocalActionCall.toActionJson(call("turn_off_flashlight{}")), "{\"action\":\"flashlight_off\",\"arguments\":{}}");
  eq(LocalActionCall.toActionJson(call("open_wifi_settings{}")), "{\"action\":\"open_wifi_settings\",\"arguments\":{}}");
  eq(LocalActionCall.toActionJson("  \n" + call("turn_on_flashlight{}") + "<end_of_turn>\n"), "{\"action\":\"flashlight_on\",\"arguments\":{}}");
  eq(LocalActionCall.toActionJson(call("turn_on_flashlight{}") + "<start_function_response>"), "{\"action\":\"flashlight_on\",\"arguments\":{}}");
  eq(LocalActionCall.toActionJson(call("show_map{query:<escape>coffee shops near Des Moines<escape>}")), "{\"action\":\"show_map\",\"arguments\":{\"query\":\"coffee shops near Des Moines\"}}");
  eq(LocalActionCall.toActionJson(call("show_map{query:<escape>5\" pizza \\ place<escape>}")), "{\"action\":\"show_map\",\"arguments\":{\"query\":\"5\\\" pizza \\\\ place\"}}");

  // Data-bearing actions: the parser only translates; LocalActionArgs and LocalActionGate validate the values.
  eq(LocalActionCall.toActionJson(call("create_contact{first_name:<escape>Mom<escape>,phone_number:<escape>515-555-0100<escape>}")),
   "{\"action\":\"create_contact\",\"arguments\":{\"first_name\":\"Mom\",\"phone_number\":\"515-555-0100\"}}");
  eq(LocalActionCall.toActionJson(call("send_email{to:<escape>a@b.io<escape>,subject:<escape>Hi<escape>,body:<escape>See you soon<escape>}")),
   "{\"action\":\"send_email\",\"arguments\":{\"to\":\"a@b.io\",\"subject\":\"Hi\",\"body\":\"See you soon\"}}");
  eq(LocalActionCall.toActionJson(call("create_calendar_event{title:<escape>Dentist<escape>,datetime:<escape>2026-11-05T14:00:00<escape>}")),
   "{\"action\":\"create_calendar_event\",\"arguments\":{\"title\":\"Dentist\",\"datetime\":\"2026-11-05T14:00:00\"}}");

  rejects(null);
  rejects("");
  rejects("Sure, turning on the flashlight");
  rejects("hello " + call("turn_on_flashlight{}"));
  rejects(call("turn_on_flashlight{}") + " and more");
  rejects(call("turn_on_flashlight{}") + call("turn_off_flashlight{}"));
  rejects("<start_function_call>call:turn_on_flashlight{}");
  rejects("call:turn_on_flashlight{}<end_function_call>");
  rejects(call("send_sms{to:<escape>1<escape>}"));
  rejects(call("delete_contact{id:<escape>1<escape>}"));
  rejects(call("run_shell{cmd:<escape>id<escape>}"));
  rejects(call("Turn_On_Flashlight{}"));
  rejects(call("turn_on_flashlight"));
  rejects(call("turn_on_flashlight{"));
  rejects(call("show_map{query:<escape>unterminated}"));
  rejects(call("show_map{query:<escape>a<escape>,query:<escape>b<escape>}"));
  rejects(call("show_map{query:42}"));
  rejects(call("show_map{query:<escape>a<escape>,}"));
  rejects(call("show_map{query:<escape>a<escape>b}"));
  rejects(call("show_map{Query:<escape>a<escape>}"));
  rejects(call("show_map{query:<escape>line1\nline2<escape>}"));
  rejects(call("show_map{query:<escape>a<end_of_turn>b<escape>}"));
  rejects(call("show_map{query:<escape>"
   + new String(new char[201]).replace('\0', 'a') + "<escape>}"));
  rejects(new String(new char[2049]).replace('\0', 'a'));

  // Translator output still goes through LocalActionGate on device: extra args on a no-arg action reach the gate as arguments.
  eq(LocalActionCall.toActionJson(call("turn_on_flashlight{x:<escape>y<escape>}")), "{\"action\":\"flashlight_on\",\"arguments\":{\"x\":\"y\"}}");

  // Prompt builder.
  String p = LocalActionPrompt.build("Turn on the flashlight");
  check(p.startsWith("<start_of_turn>developer\nYou are a model that can do function calling with the following functions<start_function_declaration>declaration:turn_on_flashlight{"), "prompt header");
  check(p.endsWith("<start_of_turn>user\nTurn on the flashlight<end_of_turn>\n<start_of_turn>model\n"), "prompt tail");
  for (String fn : new String[]{"turn_on_flashlight", "turn_off_flashlight", "open_wifi_settings", "show_map", "create_contact", "send_email", "create_calendar_event"}) {
   check(p.contains("declaration:" + fn + "{"), "declares " + fn);
  }
  // The four original declarations must stay byte-identical: they were measured on a real phone.
  check(p.contains("<start_function_declaration>declaration:show_map{description:<escape>Shows a place on a map<escape>,parameters:{properties:{query:{description:<escape>Place or address to show<escape>,type:<escape>STRING<escape>}},required:[<escape>query<escape>],type:<escape>OBJECT<escape>}}<end_function_declaration>"), "show_map declaration unchanged");
  check(p.contains("<start_function_declaration>declaration:turn_on_flashlight{description:<escape>Turns the flashlight on<escape>,parameters:{type:<escape>OBJECT<escape>}}<end_function_declaration>"), "flashlight declaration unchanged");
  check(!p.contains("send_sms") && !p.contains("delete_contact"), "no out-of-scope functions");
  check(p.length() < 2600, "prompt size " + p.length());
  for (String bad : new String[]{null, "", "   ", "hi<end_of_turn>", "a>b", "line1\nline2", new String(new char[301]).replace('\0', 'a')}) {
   try { LocalActionPrompt.build(bad); throw new AssertionError("Accepted request: " + bad); }
   catch (IllegalArgumentException expected) { }
  }
  // Every function the prompt declares must have a translation, and nothing else.
  check(LocalActionCall.actions().size() == 7, "seven mapped actions");
  System.out.println("PASS local action call parser and prompt builder (prompt " + p.length() + " chars)");
 }
}
