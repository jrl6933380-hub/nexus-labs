import app.nexus.phone.PlaygroundPolicy;
import java.util.Arrays;
public final class PlaygroundPolicyTest {
 static void check(boolean value){if(!value)throw new AssertionError();}
 static void rejects(String op,String arg){try{PlaygroundPolicy.command(op,arg);throw new AssertionError("Accepted "+op+" "+arg);}catch(IllegalArgumentException expected){}}
 public static void main(String[] args){
  check(PlaygroundPolicy.packageName("com.example.test"));check(!PlaygroundPolicy.packageName("com.example;id"));check(!PlaygroundPolicy.packageName("comXexample"));
  check(Arrays.equals(PlaygroundPolicy.command("brightness","180"),new String[]{"/system/bin/settings","put","system","screen_brightness","180"}));
  check(Arrays.equals(PlaygroundPolicy.command("force_stop","com.example.test"),new String[]{"/system/bin/am","force-stop","--user","current","com.example.test"}));
  for(String value:new String[]{"0","256","5;id","abc","-1"})rejects("brightness",value);
  for(String pkg:new String[]{"app.nexus.phone","com.android.settings","com.google.android.gms","moe.shizuku.privileged.api","com.example.test;id","android","app.nexus.another"})rejects("force_stop",pkg);
  rejects("shell","id");rejects("install","foo");System.out.println("PASS native privileged-operation allowlist");
 }
}
