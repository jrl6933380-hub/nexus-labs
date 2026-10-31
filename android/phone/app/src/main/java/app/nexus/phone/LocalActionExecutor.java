package app.nexus.phone;

import android.content.ActivityNotFoundException;
import android.content.Context;
import android.content.Intent;
import android.hardware.camera2.CameraCharacteristics;
import android.hardware.camera2.CameraManager;
import android.net.Uri;
import android.os.SystemClock;
import android.provider.CalendarContract;
import android.provider.ContactsContract;
import android.provider.Settings;
import java.time.LocalDateTime;
import java.time.ZoneId;
import org.json.JSONObject;

/**
 * Runs an action proposed by the on-device language model. Two independent checks stand in front of every action:
 *  - LocalActionGate: is this exactly one allowlisted action with valid arguments?
 *  - LocalActionPolicy: is the master switch on, does this answer belong to a ticket the user just issued by tapping,
 *    is it inside the rate limit, and is the action's risk tier satisfied?
 * The single entry point runs both itself, so a caller cannot execute an un-gated or unsolicited action.
 * Supports exactly the allowlist. The contact, email and calendar actions are CONFIRM tier: they only open the
 * system editor pre-filled, so nothing is saved or sent until the user also taps Save/Send in that app.
 * Needs no extra permissions: setTorchMode works without CAMERA, and everything else just opens a system screen.
 * Never reachable from BridgeService, accessibility or any remote command.
 */
final class LocalActionExecutor {
 private LocalActionExecutor() {}

 /**
  * @param actionJson model-derived action JSON, e.g. {"action":"flashlight_on","arguments":{}}
  * @param ticket the one-use ticket from {@link LocalActionPolicy#issue} for this request
  * @param userRequest the exact text the user submitted, which the ticket is bound to
  * @param enabled the user's master switch for local AI actions (off by default)
  * @param confirmed true only after the user tapped Yes on a screen showing the exact fields (CONFIRM tier)
  * @return a short human-readable result
  * @throws Exception when the gate or policy rejects the action or the device cannot perform it
  */
 static String execute(Context context, String actionJson, LocalActionPolicy policy, String ticket, String userRequest, boolean enabled, boolean confirmed) throws Exception {
  JSONObject approved = LocalActionGate.validate(actionJson);
  String action = approved.getString("action");
  policy.authorize(ticket, userRequest, action, enabled, confirmed, SystemClock.elapsedRealtime());
  JSONObject a = approved.getJSONObject("arguments");
  switch (action) {
   case "flashlight_on":
    torch(context, true);
    return "Flashlight on";
   case "flashlight_off":
    torch(context, false);
    return "Flashlight off";
   case "open_wifi_settings":
    open(context, new Intent(Settings.ACTION_WIFI_SETTINGS));
    return "Opened Wi-Fi settings";
   case "show_map": {
    String query = a.getString("query");
    showMap(context, query);
    return "Showing \"" + query + "\" on the map";
   }
   case "create_contact": {
    Intent i = new Intent(ContactsContract.Intents.Insert.ACTION).setType(ContactsContract.RawContacts.CONTENT_TYPE);
    String name = (a.optString("first_name", "") + " " + a.optString("last_name", "")).trim();
    if (!name.isEmpty()) i.putExtra(ContactsContract.Intents.Insert.NAME, name);
    if (a.has("phone_number")) i.putExtra(ContactsContract.Intents.Insert.PHONE, a.getString("phone_number"));
    if (a.has("email")) i.putExtra(ContactsContract.Intents.Insert.EMAIL, a.getString("email"));
    open(context, i);
    return "Opened a new contact for you to review and save";
   }
   case "send_email": {
    Intent i = new Intent(Intent.ACTION_SENDTO, Uri.parse("mailto:")).putExtra(Intent.EXTRA_EMAIL, new String[]{a.getString("to")});
    if (a.has("subject")) i.putExtra(Intent.EXTRA_SUBJECT, a.getString("subject"));
    if (a.has("body")) i.putExtra(Intent.EXTRA_TEXT, a.getString("body"));
    open(context, i);
    return "Opened an email draft for you to review and send";
   }
   case "create_calendar_event": {
    long start = LocalDateTime.parse(a.getString("datetime")).atZone(ZoneId.systemDefault()).toInstant().toEpochMilli();
    Intent i = new Intent(Intent.ACTION_INSERT, CalendarContract.Events.CONTENT_URI)
     .putExtra(CalendarContract.Events.TITLE, a.getString("title"))
     .putExtra(CalendarContract.EXTRA_EVENT_BEGIN_TIME, start)
     .putExtra(CalendarContract.EXTRA_EVENT_END_TIME, start + 3_600_000L);
    open(context, i);
    return "Opened a calendar event for you to review and save";
   }
   default:
    throw new IllegalArgumentException("Unsupported local action.");
  }
 }

 private static void open(Context context, Intent intent) {
  try {
   context.startActivity(intent.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK));
  } catch (ActivityNotFoundException none) {
   throw new IllegalStateException("No app on this phone can do that.");
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
   open(context, new Intent(Intent.ACTION_VIEW, Uri.parse("https://www.google.com/maps/search/?api=1&query=" + encoded)));
  }
 }
}
