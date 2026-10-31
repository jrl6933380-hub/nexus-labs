package app.nexus.phone;

import java.time.LocalDateTime;
import java.time.format.DateTimeParseException;
import java.util.LinkedHashMap;
import java.util.Map;
import java.util.regex.Pattern;

/**
 * Per-action argument rules for the on-device model. Model output is untrusted, so every argument is checked
 * against an exact schema: unknown keys are rejected, required keys must be present, lengths are capped, and
 * emails, phone numbers and dates must match strict patterns. Returns trimmed values; empty optional values are dropped.
 * Pure Java (no org.json, no Android) so it is unit-tested with plain javac.
 */
final class LocalActionArgs {
 private enum Kind { TEXT, EMAIL, PHONE, DATETIME }

 private static final class Field {
  final String name; final boolean required; final int max; final Kind kind;
  Field(String name, boolean required, int max, Kind kind) { this.name = name; this.required = required; this.max = max; this.kind = kind; }
 }

 // One address only: no comma, semicolon or space, so a model cannot add recipients.
 private static final Pattern EMAIL = Pattern.compile("[A-Za-z0-9._%+\\-]{1,64}@[A-Za-z0-9.\\-]{1,100}\\.[A-Za-z]{2,24}");
 private static final Pattern PHONE = Pattern.compile("[+0-9 ()\\-.]{3,30}");
 private static final Pattern DATETIME = Pattern.compile("\\d{4}-\\d{2}-\\d{2}T\\d{2}:\\d{2}(:\\d{2})?");
 private static final Field[] NONE = {};
 private static final Map<String, Field[]> SCHEMA = new LinkedHashMap<>();
 static {
  SCHEMA.put("flashlight_on", NONE);
  SCHEMA.put("flashlight_off", NONE);
  SCHEMA.put("open_wifi_settings", NONE);
  SCHEMA.put("show_map", new Field[]{ new Field("query", true, 120, Kind.TEXT) });
  SCHEMA.put("create_contact", new Field[]{
   new Field("first_name", false, 60, Kind.TEXT), new Field("last_name", false, 60, Kind.TEXT),
   new Field("phone_number", false, 30, Kind.PHONE), new Field("email", false, 120, Kind.EMAIL) });
  SCHEMA.put("send_email", new Field[]{
   new Field("to", true, 120, Kind.EMAIL), new Field("subject", false, 120, Kind.TEXT), new Field("body", false, 200, Kind.TEXT) });
  SCHEMA.put("create_calendar_event", new Field[]{
   new Field("title", true, 100, Kind.TEXT), new Field("datetime", true, 19, Kind.DATETIME) });
 }

 private LocalActionArgs() {}

 static boolean known(String action) { return action != null && SCHEMA.containsKey(action); }

 /** @throws IllegalArgumentException when the action is unknown or any argument breaks its rule */
 static Map<String, String> normalize(String action, Map<String, String> given) {
  Field[] fields = action == null ? null : SCHEMA.get(action);
  if (fields == null) throw new IllegalArgumentException("Unsupported local action.");
  for (String key : given.keySet()) {
   boolean allowed = false;
   for (Field f : fields) if (f.name.equals(key)) allowed = true;
   if (!allowed) throw new IllegalArgumentException("Unexpected arguments.");
  }
  Map<String, String> out = new LinkedHashMap<>();
  for (Field f : fields) {
   String v = given.get(f.name);
   if (v != null) v = v.trim();
   if (v == null || v.isEmpty()) {
    if (f.required) throw new IllegalArgumentException("Missing " + f.name + ".");
    continue;
   }
   if (v.length() > f.max) throw new IllegalArgumentException(f.name + " is too long.");
   for (int i = 0; i < v.length(); i++) {
    char c = v.charAt(i);
    if (c < 0x20 || c == 0x7f || c == '<' || c == '>') throw new IllegalArgumentException(f.name + " has unsupported characters.");
   }
   switch (f.kind) {
    case EMAIL:
     if (!EMAIL.matcher(v).matches()) throw new IllegalArgumentException(f.name + " is not a valid email address.");
     break;
    case PHONE:
     if (!PHONE.matcher(v).matches()) throw new IllegalArgumentException(f.name + " is not a valid phone number.");
     break;
    case DATETIME:
     if (!DATETIME.matcher(v).matches()) throw new IllegalArgumentException(f.name + " must look like 2026-11-05T14:00:00.");
     try {
      int year = LocalDateTime.parse(v).getYear();
      if (year < 2020 || year > 2100) throw new IllegalArgumentException(f.name + " is out of range.");
     } catch (DateTimeParseException e) { throw new IllegalArgumentException(f.name + " is not a real date and time."); }
     break;
    default:
     break;
   }
   out.put(f.name, v);
  }
  if ("create_contact".equals(action) && !out.containsKey("first_name") && !out.containsKey("last_name"))
   throw new IllegalArgumentException("A contact needs a name.");
  return out;
 }
}
