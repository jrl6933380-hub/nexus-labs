package app.nexus.phone;

/**
 * Public entry point for the isolated Local AI Lab. LocalActionGate is package-private on purpose, so
 * the lab (a different package) reaches it only through this class. It builds prompts and validates
 * model output; it executes nothing.
 */
public final class LocalActionBridge {
 private LocalActionBridge() {}

 /** @throws IllegalArgumentException when the request is empty, too long, or contains control characters or angle brackets. */
 public static String buildPrompt(String userRequest) {
  return LocalActionPrompt.build(userRequest);
 }

 /**
  * Parses FunctionGemma's function-call text, then runs it through LocalActionGate.
  * @return validated JSON such as {"action":"flashlight_on","arguments":{}}
  * @throws Exception when the output is not exactly one allowed call with valid arguments
  */
 public static String validate(String modelOutput) throws Exception {
  return LocalActionGate.validate(LocalActionCall.toActionJson(modelOutput)).toString();
 }
}
