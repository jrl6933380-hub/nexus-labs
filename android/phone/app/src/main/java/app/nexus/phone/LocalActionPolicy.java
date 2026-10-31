package app.nexus.phone;

import java.nio.charset.StandardCharsets;
import java.security.MessageDigest;
import java.security.SecureRandom;
import java.util.ArrayDeque;
import java.util.ArrayList;
import java.util.HashMap;
import java.util.List;
import java.util.Map;

/**
 * Hard policy around the on-device model. LocalActionGate checks WHAT the model asked for; this checks WHETHER
 * it may run right now. Every execution must pass all of:
 *  1. the master switch is on (default off, owned by the user),
 *  2. a one-use ticket issued when the user tapped a button or pressed Ask, bound to that exact request text,
 *     expiring after 30 seconds, so stale, replayed or unsolicited model output can never act,
 *  3. the action has a known risk tier (anything unknown is denied; CONFIRM tier also needs an explicit yes),
 *  4. a rate limit (6 per minute).
 * Every decision is recorded in a bounded audit trail. The model never decides any of this.
 * Pure Java, no Android types, so it is unit-tested with plain javac.
 */
final class LocalActionPolicy {
 enum Risk { LOW, CONFIRM }

 static final long TICKET_TTL_MS = 30_000L;
 static final long WINDOW_MS = 60_000L;
 static final int MAX_PER_WINDOW = 6;
 static final int AUDIT_MAX = 50;

 private static final Map<String, Risk> RISK = new HashMap<>();
 static {
  // LOW: opens a system screen or toggles the torch. No data leaves, nothing is changed that Back cannot undo.
  RISK.put("flashlight_on", Risk.LOW);
  RISK.put("flashlight_off", Risk.LOW);
  RISK.put("open_wifi_settings", Risk.LOW);
  RISK.put("show_map", Risk.LOW);
  // Future actions that message, call, install or delete must be added here as CONFIRM, never LOW.
 }

 private final SecureRandom random;
 private String ticket;
 private byte[] requestHash;
 private long expiresAt;
 private final ArrayDeque<Long> recent = new ArrayDeque<>();
 private final ArrayDeque<String> audit = new ArrayDeque<>();

 LocalActionPolicy() { this(new SecureRandom()); }
 LocalActionPolicy(SecureRandom random) { this.random = random; }

 static Risk risk(String action) {
  Risk r = action == null ? null : RISK.get(action);
  if (r == null) throw new SecurityException("Action is not on the local allowlist.");
  return r;
 }

 /** Called when the user taps a button or presses Ask. Replaces any older ticket. */
 synchronized String issue(String userRequest, long now) {
  byte[] raw = new byte[16];
  random.nextBytes(raw);
  ticket = hex(raw);
  requestHash = sha256(userRequest);
  expiresAt = now + TICKET_TTL_MS;
  record(now, "ticket issued");
  return ticket;
 }

 /**
  * Called after the model answered and LocalActionGate approved the action.
  * @throws SecurityException when any check fails; the ticket is consumed either way.
  */
 synchronized void authorize(String presentedTicket, String userRequest, String action, boolean enabled, boolean confirmed, long now) {
  try {
   String held = ticket;
   byte[] heldHash = requestHash;
   long heldExpiry = expiresAt;
   ticket = null; requestHash = null; expiresAt = 0; // single use, even if a later check fails
   if (!enabled) throw new SecurityException("Local AI actions are switched off.");
   if (held == null || presentedTicket == null
    || !MessageDigest.isEqual(held.getBytes(StandardCharsets.UTF_8), presentedTicket.getBytes(StandardCharsets.UTF_8)))
    throw new SecurityException("No valid ticket for this request.");
   if (now > heldExpiry) throw new SecurityException("Ticket expired.");
   if (!MessageDigest.isEqual(heldHash, sha256(userRequest))) throw new SecurityException("Request changed after the ticket was issued.");
   Risk r = risk(action);
   if (r == Risk.CONFIRM && !confirmed) throw new SecurityException("This action needs your confirmation.");
   while (!recent.isEmpty() && now - recent.peekFirst() >= WINDOW_MS) recent.pollFirst();
   if (recent.size() >= MAX_PER_WINDOW) throw new SecurityException("Too many local actions; wait a minute.");
   recent.addLast(now);
  } catch (SecurityException denied) {
   record(now, "DENIED " + String.valueOf(action) + ": " + denied.getMessage());
   throw denied;
  }
  record(now, "APPROVED " + action);
 }

 synchronized List<String> auditTrail() { return new ArrayList<>(audit); }

 private void record(long now, String line) {
  audit.addLast(now + " " + line);
  while (audit.size() > AUDIT_MAX) audit.pollFirst();
 }

 private static byte[] sha256(String s) {
  try { return MessageDigest.getInstance("SHA-256").digest((s == null ? "" : s).getBytes(StandardCharsets.UTF_8)); }
  catch (java.security.NoSuchAlgorithmException e) { throw new IllegalStateException(e); }
 }

 private static String hex(byte[] b) {
  StringBuilder sb = new StringBuilder();
  for (byte x : b) sb.append(String.format("%02x", x));
  return sb.toString();
 }
}
