package app.nexus.phone;
import android.app.*;
import android.content.*;
import android.os.*;
import org.json.*;
/** Instrumentation-only test APK; never included in the phone release. */
public final class PhoneTestRunner extends Instrumentation {
 private boolean shizukuTest;
 @Override public void onCreate(Bundle args){super.onCreate(args);shizukuTest=args!=null&&"true".equals(args.getString("shizuku"));start();}
 void check(boolean value,String message){if(!value)throw new AssertionError(message);}
 JSONObject command(String action) throws Exception {return new JSONObject().put("id",java.util.UUID.randomUUID().toString()).put("expires_at",System.currentTimeMillis()+45000).put("input",new JSONObject().put("action",action));}
 @Override public void onStart(){Bundle out=new Bundle();try{
  android.content.Context c=getTargetContext();Activity activity=startActivitySync(new Intent(c,MainActivity.class).addFlags(Intent.FLAG_ACTIVITY_NEW_TASK));waitForIdleSync();
  if(shizukuTest){testShizuku(c);return;}
  check(NexusAdmin.owner(c),"device owner provisioned");NexusAdmin.makeHome(c);
  android.content.pm.ResolveInfo home=c.getPackageManager().resolveActivity(new Intent(Intent.ACTION_MAIN).addCategory(Intent.CATEGORY_HOME),android.content.pm.PackageManager.MATCH_DEFAULT_ONLY);
  check(home!=null&&c.getPackageName().equals(home.activityInfo.packageName),"Nexus is preferred Home");
  // am instrument force-stops the target process; rebind accessibility after that restart.
  shell("settings put secure enabled_accessibility_services ''");
  shell("settings put secure enabled_accessibility_services app.nexus.phone/.PhoneAccessibility");
  shell("settings put secure accessibility_enabled 1");
  long until=System.currentTimeMillis()+15000;while(PhoneAccessibility.instance==null&&System.currentTimeMillis()<until)Thread.sleep(100);
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
 void shell(String command) throws Exception {try(java.io.InputStream in=new android.os.ParcelFileDescriptor.AutoCloseInputStream(getUiAutomation(android.app.UiAutomation.FLAG_DONT_SUPPRESS_ACCESSIBILITY_SERVICES).executeShellCommand(command))){byte[] buf=new byte[1024];while(in.read(buf)!=-1){}}}
 void testShizuku(android.content.Context c) throws Exception {
  long until=System.currentTimeMillis()+15000;while(!rikka.shizuku.Shizuku.pingBinder()&&System.currentTimeMillis()<until)Thread.sleep(100);
  check(rikka.shizuku.Shizuku.pingBinder(),"Shizuku binder received");
  if(!ShizukuAccess.ready()){
   android.app.UiAutomation automation=getUiAutomation(android.app.UiAutomation.FLAG_DONT_SUPPRESS_ACCESSIBILITY_SERVICES);
   runOnMainSync(()->ShizukuAccess.request());
   until=System.currentTimeMillis()+10000;boolean clicked=false;
   while(!clicked&&System.currentTimeMillis()<until){
    android.view.accessibility.AccessibilityNodeInfo root=automation.getRootInActiveWindow();
    if(root!=null){for(android.view.accessibility.AccessibilityNodeInfo n:root.findAccessibilityNodeInfosByText("Allow all the time")){
     for(int depth=0;n!=null&&depth<4;depth++,n=n.getParent()){if(n.isClickable()&&n.performAction(android.view.accessibility.AccessibilityNodeInfo.ACTION_CLICK)){clicked=true;break;}}if(clicked)break;
    }}Thread.sleep(200);
   }
   check(clicked,"Shizuku authorization button found");
   until=System.currentTimeMillis()+5000;while(!ShizukuAccess.ready()&&System.currentTimeMillis()<until)Thread.sleep(100);
  }
  check(ShizukuAccess.ready(),"Shizuku authorized");check(rikka.shizuku.Shizuku.getUid()==2000,"ADB shell backend");
  c.getSharedPreferences(PhoneApi.PREFS,0).edit().putBoolean("deeper_tools",true).commit();
  int before=android.provider.Settings.System.getInt(c.getContentResolver(),android.provider.Settings.System.SCREEN_BRIGHTNESS,128);
  try{ShizukuAccess.run(c,"brightness","173",()->true);check(android.provider.Settings.System.getInt(c.getContentResolver(),android.provider.Settings.System.SCREEN_BRIGHTNESS)==173,"privileged brightness applied");}
  finally{ShizukuAccess.run(c,"brightness",Integer.toString(Math.max(5,Math.min(255,before))),()->true);}
  getTargetContext().getPackageManager().getPackageInfo("com.example.nexusplaygroundtest",0);
  ShizukuAccess.run(c,"force_stop","com.example.nexusplaygroundtest",()->true);
  // The service itself must reject a forbidden target, independent of client validation.
  boolean blocked=false;try{ShizukuAccess.run(c,"force_stop","com.android.settings",()->true);}catch(Exception expected){blocked=true;}check(blocked,"privileged service rejects core app");
  boolean stopped=false;try{ShizukuAccess.run(c,"brightness","175",()->false);}catch(Exception expected){stopped=true;}check(stopped,"session stop fences privileged operation");
  Bundle result=new Bundle();result.putString("stream","PASS actual Shizuku shell backend, authorization, brightness, force-stop, service allowlist and session fence\n");finish(Activity.RESULT_OK,result);
 }
}
