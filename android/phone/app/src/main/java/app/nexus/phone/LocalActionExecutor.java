package app.nexus.phone;

import android.content.ActivityNotFoundException;
import android.content.Context;
import android.content.Intent;
import android.hardware.camera2.CameraCharacteristics;
import android.hardware.camera2.CameraManager;
import android.net.Uri;
import android.provider.Settings;
import org.json.JSONObject;

/**
 * Runs an action proposed by the on-device language model, but only after LocalActionGate approves it.
 * The single entry point re-validates the JSON itself, so a caller cannot execute an un-gated action.
 * Supports exactly the gate allowlist: flashlight_on, flashlight_off, open_wifi_settings, show_map.
 * Needs no extra permissions: setTorchMode works without CAMERA, and the other two just open system screens.
 */
final class LocalActionExecutor {
 private LocalActionExecutor() {}

 /**
  * @param actionJson model-derived action JSON, e.g. {"action":"flashlight_on","arguments":{}}
  * @return a short human-readable result
  * @throws Exception when the gate rejects the action or the device cannot perform it
  */
 static String execute(Context context, String actionJson) throws Exception {
  JSONObject approved = LocalActionGate.validate(actionJson);
  String action = approved.getString("action");
  switch (action) {
   case "flashlight_on":
    torch(context, true);
    return "Flashlight on";
   case "flashlight_off":
    torch(context, false);
    return "Flashlight off";
   case "open_wifi_settings":
    context.startActivity(new Intent(Settings.ACTION_WIFI_SETTINGS).addFlags(Intent.FLAG_ACTIVITY_NEW_TASK));
    return "Opened Wi-Fi settings";
   case "show_map": {
    String query = approved.getJSONObject("arguments").getString("query");
    showMap(context, query);
    return "Showing \"" + query + "\" on the map";
   }
   default:
    throw new IllegalArgumentException("Unsupported local action.");
  }
 }

 private static void torch(Context context, boolean on) throws Exception {
  CameraManager manager = context.getSystemService(CameraManager.class);
  if (manager == null) throw new IllegalStateException("No camera service on this phone.");
  String fallback = null;
  for (String id : manager.getCameraIdList()) {
   CameraCharacteristics c = manager.getCameraCharacteristics(id);
   Boolean flash = c.get(CameraCharacteristics.FLASH_INFO_AVAILABLE);
   if (flash == null || !flash) continue;
   Integer facing = c.get(CameraCharacteristics.LENS_FACING);
   if (facing != null && facing == CameraCharacteristics.LENS_FACING_BACK) {
    manager.setTorchMode(id, on);
    return;
   }
   if (fallback == null) fallback = id;
  }
  if (fallback == null) throw new IllegalStateException("This phone has no flashlight.");
  manager.setTorchMode(fallback, on);
 }

 private static void showMap(Context context, String query) {
  String encoded = Uri.encode(query);
  try {
   context.startActivity(new Intent(Intent.ACTION_VIEW, Uri.parse("geo:0,0?q=" + encoded)).addFlags(Intent.FLAG_ACTIVITY_NEW_TASK));
  } catch (ActivityNotFoundException noMapApp) {
   // No map app handles geo: links, so open the same search in the browser instead.
   context.startActivity(new Intent(Intent.ACTION_VIEW, Uri.parse("https://www.google.com/maps/search/?api=1&query=" + encoded)).addFlags(Intent.FLAG_ACTIVITY_NEW_TASK));
  }
 }
}
