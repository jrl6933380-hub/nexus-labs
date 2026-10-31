package app.nexus.phone;

import org.json.JSONObject;
import java.util.Arrays;
import java.util.HashSet;
import java.util.Set;

/**
 * Trust boundary for commands proposed by an on-device language model.
 * Model output is untrusted. This gate does NOT execute actions.
 * Keep the allowlist intentionally smaller than the remote phone bridge.
 */
final class LocalActionGate {
 private static final Set<String> ALLOWED = new HashSet<>(Arrays.asList(
  "flashlight_on", "flashlight_off", "open_wifi_settings", "show_map"
 ));
 private LocalActionGate() {}

 static JSONObject validate(String raw) throws Exception {
  if(raw == null || raw.length() > 2048) throw new IllegalArgumentException("Invalid model output length.");
  JSONObject proposed = new JSONObject(raw);
  if(proposed.length() != 1 && proposed.length() != 2)
   throw new IllegalArgumentException("Unexpected action fields.");
  String action = proposed.getString("action");
  if(!ALLOWED.contains(action)) throw new IllegalArgumentException("Unsupported local action.");
  if(!proposed.has("arguments")) {
   if("show_map".equals(action)) throw new IllegalArgumentException("Missing location.");
   return new JSONObject().put("action", action).put("arguments", new JSONObject());
  }
  JSONObject args = proposed.getJSONObject("arguments");
  if("show_map".equals(action)) {
   if(args.length()!=1) throw new IllegalArgumentException("Unexpected map arguments.");
   String query = args.getString("query").trim();
   if(query.isEmpty() || query.length()>120 || query.indexOf('\n')>=0)
    throw new IllegalArgumentException("Invalid map query.");
   return new JSONObject().put("action",action).put("arguments",new JSONObject().put("query",query));
  }
  if(args.length()!=0) throw new IllegalArgumentException("Unexpected arguments.");
  return new JSONObject().put("action",action).put("arguments",new JSONObject());
 }
}
