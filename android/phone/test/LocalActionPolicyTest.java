package app.nexus.phone;

import java.util.List;

public final class LocalActionPolicyTest {
 private static int failures = 0;
 private static void check(boolean ok, String name) { if (!ok) { failures++; System.err.println("FAIL: " + name); } }
 private static boolean denied(Runnable r) { try { r.run(); return false; } catch (SecurityException e) { return true; } }

 public static void main(String[] args) {
  long t = 1_000_000L;
  String req = "Turn on the flashlight";

  LocalActionPolicy p = new LocalActionPolicy();
  String tk = p.issue(req, t);
  p.authorize(tk, req, "flashlight_on", true, false, t + 100);
  check(true, "happy path approves");

  check(denied(() -> p.authorize(tk, req, "flashlight_on", true, false, t + 200)), "replaying a used ticket is denied");

  p.issue(req, t);
  check(denied(() -> p.authorize("deadbeef", req, "flashlight_on", true, false, t + 10)), "wrong ticket denied");

  LocalActionPolicy p2 = new LocalActionPolicy();
  String t2 = p2.issue(req, t);
  check(denied(() -> p2.authorize(t2, req, "flashlight_on", true, false, t + LocalActionPolicy.TICKET_TTL_MS + 1)), "expired ticket denied");

  LocalActionPolicy p3 = new LocalActionPolicy();
  String t3 = p3.issue(req, t);
  check(denied(() -> p3.authorize(t3, "Open Wi-Fi settings", "open_wifi_settings", true, false, t + 5)), "ticket bound to the request text");

  LocalActionPolicy p4 = new LocalActionPolicy();
  String t4 = p4.issue(req, t);
  check(denied(() -> p4.authorize(t4, req, "flashlight_on", false, false, t + 5)), "master switch off denies");

  LocalActionPolicy p5 = new LocalActionPolicy();
  String t5 = p5.issue(req, t);
  check(denied(() -> p5.authorize(t5, req, "send_sms", true, true, t + 5)), "unknown action denied even if confirmed");

  LocalActionPolicy p6 = new LocalActionPolicy();
  check(denied(() -> p6.authorize(null, req, "flashlight_on", true, false, t)), "no ticket issued denied");

  LocalActionPolicy p7 = new LocalActionPolicy();
  String old = p7.issue(req, t);
  String fresh = p7.issue(req, t + 1);
  check(denied(() -> p7.authorize(old, req, "flashlight_on", true, false, t + 2)), "newer ticket invalidates older one");

  LocalActionPolicy p8 = new LocalActionPolicy();
  for (int i = 0; i < LocalActionPolicy.MAX_PER_WINDOW; i++) {
   String k = p8.issue(req, t + i);
   p8.authorize(k, req, "flashlight_on", true, false, t + i);
  }
  String extra = p8.issue(req, t + 10);
  check(denied(() -> p8.authorize(extra, req, "flashlight_on", true, false, t + 10)), "7th action in a minute denied");
  String later = p8.issue(req, t + LocalActionPolicy.WINDOW_MS + 10);
  p8.authorize(later, req, "flashlight_on", true, false, t + LocalActionPolicy.WINDOW_MS + 10);
  check(true, "allowed again after the window");

  LocalActionPolicy pc = new LocalActionPolicy();
  String tc = pc.issue(req, t);
  check(denied(() -> pc.authorize(tc, req, "send_email", true, false, t + 1)), "send_email needs confirmation");
  String tc2 = pc.issue(req, t + 2);
  pc.authorize(tc2, req, "send_email", true, true, t + 2);
  check(true, "send_email approved once confirmed");
  for (String a : new String[]{"create_contact", "send_email", "create_calendar_event"})
   check(LocalActionPolicy.risk(a) == LocalActionPolicy.Risk.CONFIRM, a + " is CONFIRM tier");
  for (String a : new String[]{"flashlight_on", "flashlight_off", "open_wifi_settings", "show_map"})
   check(LocalActionPolicy.risk(a) == LocalActionPolicy.Risk.LOW, a + " is LOW tier");

  check(denied(() -> LocalActionPolicy.risk("delete_everything")), "risk() rejects unknown");
  check(denied(() -> LocalActionPolicy.risk(null)), "risk() rejects null");

  LocalActionPolicy p9 = new LocalActionPolicy();
  for (int i = 0; i < 80; i++) p9.issue(req, t + i);
  List<String> trail = p9.auditTrail();
  check(trail.size() == LocalActionPolicy.AUDIT_MAX, "audit trail is bounded");
  check(p8.auditTrail().stream().anyMatch(s -> s.contains("DENIED")), "denials are audited");
  check(p8.auditTrail().stream().noneMatch(s -> s.contains(req)), "audit never stores the request text");

  if (failures > 0) { System.err.println(failures + " test(s) failed"); System.exit(1); }
  System.out.println("LocalActionPolicyTest passed");
 }
}
