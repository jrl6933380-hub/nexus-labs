package app.nexus.phone;
import android.app.Activity;
import android.app.AlertDialog;
import android.content.Intent;
import android.net.Uri;
/** Explicit app launches only: no prompt, account data, or automatic message submission. */
public final class AssistantApps {
 public static final String CLAUDE="com.anthropic.claude",CHATGPT="com.openai.chatgpt";
 public static Intent launchIntent(Activity a,String pkg){return a.getPackageManager().getLaunchIntentForPackage(pkg);}
 public static void open(Activity a,int direction){
  String pkg=direction<0?CLAUDE:CHATGPT,name=direction<0?"Claude":"ChatGPT";
  try{Intent launch=launchIntent(a,pkg);if(launch!=null){a.startActivity(launch);return;}}catch(android.content.ActivityNotFoundException|SecurityException ignored){}
  new AlertDialog.Builder(a).setTitle("Open "+name).setMessage(name+" is not installed or cannot be opened. Install the official app, or use its website.")
   .setNegativeButton("Cancel",null).setNeutralButton("Website",(d,w)->view(a,direction<0?"https://claude.ai/":"https://chatgpt.com/"))
   .setPositiveButton("Get app",(d,w)->view(a,"https://play.google.com/store/apps/details?id="+pkg)).show();
 }
 private static void view(Activity a,String url){try{a.startActivity(new Intent(Intent.ACTION_VIEW,Uri.parse(url)));}catch(android.content.ActivityNotFoundException|SecurityException e){android.widget.Toast.makeText(a,"No browser available. Open the official app store on this phone.",android.widget.Toast.LENGTH_LONG).show();}}
 private AssistantApps(){}
}
