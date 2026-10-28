package app.nexus.phone;
/** Pure allowlist shared by the app and its privileged service. Never accepts shell text. */
public final class PlaygroundPolicy {
 private PlaygroundPolicy(){}
 public static boolean packageName(String p){return p!=null&&p.length()<=200&&p.matches("[A-Za-z][A-Za-z0-9_]*(\\.[A-Za-z][A-Za-z0-9_]*)+");}
 public static boolean forceStopTarget(String p){return packageName(p)&&!p.startsWith("app.nexus.")&&!p.startsWith("android.")&&!p.equals("android")&&!p.startsWith("com.android.")&&!p.startsWith("com.google.android.")&&!p.equals("moe.shizuku.privileged.api");}
 public static String[] command(String op,String arg){
  if("brightness".equals(op)){int n=Integer.parseInt(arg);if(n<5||n>255)throw new IllegalArgumentException("Brightness must be 5–255.");return new String[]{"/system/bin/settings","put","system","screen_brightness",Integer.toString(n)};}
  if("force_stop".equals(op)&&forceStopTarget(arg))return new String[]{"/system/bin/am","force-stop","--user","current",arg};
  throw new IllegalArgumentException("Unsupported privileged operation.");
 }
}
