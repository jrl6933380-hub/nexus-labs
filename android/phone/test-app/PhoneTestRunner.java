package app.nexus.phone;
import android.app.*;
import android.content.*;
import android.os.*;
import org.json.*;
/** Instrumentation-only test APK; never included in the phone release. */
public final class PhoneTestRunner extends Instrumentation {
 @Override public void onCreate(Bundle args){super.onCreate(args);start();}
 void check(boolean value,String message){if(!value)throw new AssertionError(message);}
 JSONObject command(String action) throws Exception {return new JSONObject().put("id",java.util.UUID.randomUUID().toString()).put("expires_at",System.currentTimeMillis()+45000).put("input",new JSONObject().put("action",action));}
 @Override public void onStart(){Bundle out=new Bundle();try{
  android.content.Context c=getTargetContext();Activity activity=startActivitySync(new Intent(c,MainActivity.class).addFlags(Intent.FLAG_ACTIVITY_NEW_TASK));waitForIdleSync();
  check(NexusAdmin.owner(c),"device owner provisioned");NexusAdmin.makeHome(c);
  android.content.pm.ResolveInfo home=c.getPackageManager().resolveActivity(new Intent(Intent.ACTION_MAIN).addCategory(Intent.CATEGORY_HOME),android.content.pm.PackageManager.MATCH_DEFAULT_ONLY);
  check(home!=null&&c.getPackageName().equals(home.activityInfo.packageName),"Nexus is preferred Home");
  long until=System.currentTimeMillis()+10000;while(PhoneAccessibility.instance==null&&System.currentTimeMillis()<until)Thread.sleep(100);
  check(PhoneAccessibility.instance!=null,"accessibility connected");String session=java.util.UUID.randomUUID().toString();BridgeService.currentSession=session;BridgeService.active=true;
  JSONObject info=PhoneAccessibility.instance.execute(command("device_info"),session);check(info.getBoolean("ok")&&info.getJSONObject("data").getBoolean("device_owner"),"device capabilities");
  check(!info.getJSONObject("data").getBoolean("shizuku_ready"),"Shizuku absence reported truthfully");
  JSONObject apps=PhoneAccessibility.instance.execute(command("list_apps"),session);check(apps.getBoolean("ok")&&apps.getJSONObject("data").getJSONArray("apps").length()>0,"app list");
  JSONObject awake=command("stay_awake");awake.getJSONObject("input").put("enabled",true);
  check(!PhoneAccessibility.instance.execute(awake,session).getBoolean("ok"),"deeper tools disabled initially");
  c.getSharedPreferences(PhoneApi.PREFS,0).edit().putBoolean("deeper_tools",true).commit();
  JSONObject awakeResult=PhoneAccessibility.instance.execute(awake,session);check(awakeResult.getBoolean("ok"),"managed stay-awake setting");
  check("7".equals(android.provider.Settings.Global.getString(c.getContentResolver(),android.provider.Settings.Global.STAY_ON_WHILE_PLUGGED_IN)),"stay awake applied");
  JSONObject brightness=command("brightness");brightness.getJSONObject("input").put("value",180);check(!PhoneAccessibility.instance.execute(brightness,session).getBoolean("ok"),"Shizuku unavailable fails clearly");
  JSONObject frame=PhoneAccessibility.instance.execute(command("home"),session);check(frame.getBoolean("ok")&&frame.has("image_base64"),"Home returns fresh screenshot");
  java.io.File image=new java.io.File(c.getExternalFilesDir(null),"nexus-home.jpg");try(java.io.FileOutputStream f=new java.io.FileOutputStream(image)){f.write(android.util.Base64.decode(frame.getString("image_base64"),android.util.Base64.DEFAULT));}
  JSONObject stale=command("tap");stale.getJSONObject("input").put("frame_id",java.util.UUID.randomUUID().toString()).put("x",0.5).put("y",0.5);check(!PhoneAccessibility.instance.execute(stale,session).getBoolean("ok"),"stale tap rejected");
  BridgeService.active=false;check(!PhoneAccessibility.instance.execute(command("home"),session).getBoolean("ok"),"disconnect fences actions");
  NexusAdmin.releaseHome(c);c.getSystemService(android.app.admin.DevicePolicyManager.class).clearDeviceOwnerApp(c.getPackageName());check(!NexusAdmin.owner(c),"local management recovery");
  out.putString("stream","PASS native device-owner, Home, capabilities, app list, deeper-tools gate, stay-awake, Shizuku absence, action screenshot, stale frame, disconnect and management recovery\n");finish(Activity.RESULT_OK,out);
 }catch(Throwable e){out.putString("stream","FAIL "+e.toString()+"\n"+android.util.Log.getStackTraceString(e));finish(Activity.RESULT_CANCELED,out);}}
}
