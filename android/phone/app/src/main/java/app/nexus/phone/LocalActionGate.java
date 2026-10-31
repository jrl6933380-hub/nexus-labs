package app.nexus.phone;

import org.json.JSONObject;
import java.util.Iterator;
import java.util.LinkedHashMap;
import java.util.Map;

/**
 * Trust boundary for commands proposed by an on-device language model.
 * Model output is untrusted. This gate does NOT execute actions.
 * Keep the allowlist intentionally smaller than the remote phone bridge.
 * The allowlist and the exact argument rules live in LocalActionArgs (pure Java, unit-tested).
 */
final class LocalActionGate {
 private LocalActionGate() {}

 static JSONObject validate(String raw) throws Exception {
  if(raw == null || raw.length() > 2048) throw new IllegalArgumentException("Invalid model output length.");
  JSONObject proposed = new JSONObject(raw);
  boolean hasArgs = proposed.has("arguments");
  if(proposed.length() != (hasArgs ? 2 : 1)) throw new IllegalArgumentException("Unexpected action fields.");
  Object actionValue = proposed.get("action");
  if(!(actionValue instanceof String)) throw new IllegalArgumentException("Action must be text.");
  String action = (String) actionValue;
  if(!LocalActionArgs.known(action)) throw new IllegalArgumentException("Unsupported local action.");
  Map<String, String> given = new LinkedHashMap<>();
  if(hasArgs) {
   Object argsValue = proposed.get("arguments");
   if(!(argsValue instanceof JSONObject)) throw new IllegalArgumentException("Arguments must be an object.");
   JSONObject args = (JSONObject) argsValue;
   Iterator<String> keys = args.keys();
   while(keys.hasNext()) {
    String key = keys.next();
    Object value = args.get(key);
    if(!(value instanceof String)) throw new IllegalArgumentException("Arguments must be text.");
    given.put(key, (String) value);
   }
  }
  Map<String, String> clean = LocalActionArgs.normalize(action, given);
  JSONObject cleanArgs = new JSONObject();
  for(Map.Entry<String, String> e : clean.entrySet()) cleanArgs.put(e.getKey(), e.getValue());
  return new JSONObject().put("action", action).put("arguments", cleanArgs);
 }
}
