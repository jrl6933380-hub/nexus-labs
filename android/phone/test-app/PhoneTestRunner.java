package app.nexus.phone;
import android.app.*;
import android.content.*;
import android.os.*;
import org.json.*;
/** Instrumentation-only test APK; never included in the phone release. */
public final class PhoneTestRunner extends Instrumentation {
 private boolean shizukuTest,assistantFixtures;
 @Override public void onCreate(Bundle args){super.onCreate(args);shizukuTest=args!=null&&"true".equals(args.getString("shizuku"));assistantFixtures=args!=null&&"true".equals(args.getString("assistants"));start();}
 void check(boolean value,String message){if(!value)throw new AssertionError(message);}
 JSONObject command(String action) throws Exception {return new JSONObject().put("id",java.util.UUID.randomUUID().toString()).put("expires_at",System.currentTimeMillis()+45000).put("input",new JSONObject().put("action",action));}
 @Override public void onStart(){Bundle out=new Bundle();try{
  android.content.Context c=getTargetContext();Activity activity=startActivitySync(new Intent(c,MainActivity.class).addFlags(Intent.FLAG_ACTIVITY_NEW_TASK));waitForIdleSync();
  if(shizukuTest){testShizuku(c);return;}
  if(assistantFixtures){testAssistantLaunches((MainActivity)activity);return;}
  testAssistantGestures((MainActivity)activity);
  runOnMainSync(()->((MainActivity)activity).onNewIntent(new Intent(Intent.ACTION_VIEW,android.net.Uri.parse("nexusphone://connect"))));waitForIdleSync();
  check(((MainActivity)activity).code.hasFocus(),"native app link focuses pairing without starting control");
  check(!BridgeService.active,"deep link does not start remote control");
  runOnMainSync(()->((MainActivity)activity).onNewIntent(new Intent(Intent.ACTION_MAIN).addCategory(Intent.CATEGORY_HOME)));waitForIdleSync();
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
 void testAssistantGestures(MainActivity activity) throws Exception {
  final int[] calls={0},direction={0};final HomeSwipeView[] view={null};final android.widget.Button[] child={null};final int[] clicks={0};
  runOnMainSync(()->{view[0]=new HomeSwipeView(activity,d->{calls[0]++;direction[0]=d;});child[0]=new android.widget.Button(activity);child[0].setText("Fixture button");child[0].setOnClickListener(v->clicks[0]++);view[0].addView(child[0],new android.widget.LinearLayout.LayoutParams(-1,activity.dp(60)));activity.layout.addView(view[0],0);});waitForIdleSync();
  gesture(view[0],activity,240,30,40,30,false);check(calls[0]==1&&direction[0]==-1,"left swipe selects Claude");check(clicks[0]==0,"swipe cancels child click");
  gesture(view[0],activity,40,30,240,30,false);check(calls[0]==2&&direction[0]==1,"right swipe selects ChatGPT");
  gesture(view[0],activity,40,30,70,30,false);check(calls[0]==2,"short drag does not launch");
  gesture(view[0],activity,40,10,50,160,false);check(calls[0]==2,"vertical scroll does not launch");
  gesture(view[0],activity,40,10,240,180,false);check(calls[0]==2,"diagonal does not launch");
  gesture(view[0],activity,240,30,40,30,true);check(calls[0]==2,"canceled gesture does not launch");
  runOnMainSync(()->{long t=android.os.SystemClock.uptimeMillis();touch(view[0],t,t,0,40,30,activity);touch(view[0],t,t+10,1,40,30,activity);});check(clicks[0]==1,"ordinary child tap stays usable");
  runOnMainSync(()->activity.layout.removeView(view[0]));
  check("https://claude.ai/".equals(HomeShortcuts.target(activity,-1))&&"https://chatgpt.com/".equals(HomeShortcuts.target(activity,1)),"default website targets");
  for(String bad:new String[]{"javascript:alert(1)","intent://anything","file:///secret","https://user:pass@example.com","not a url"}){boolean rejected=false;try{HomeShortcuts.webUrl(bad);}catch(IllegalArgumentException expected){rejected=true;}check(rejected,"unsafe or invalid URL rejected");}
  HomeShortcuts.save(activity,-1,"web","Custom lab","https://example.com/lab?q=1","missing.browser");check("Custom lab".equals(HomeShortcuts.label(activity,-1))&&"https://example.com/lab?q=1".equals(HomeShortcuts.target(activity,-1)),"custom shortcut stored independently");check("ChatGPT".equals(HomeShortcuts.label(activity,1)),"right target unchanged");
  HomeShortcuts.save(activity,-1,"app","Missing fixture","com.example.notinstalled","");HomeShortcuts.save(activity,1,"web","Missing browser","https://example.com/","com.example.notinstalled");
  check(HomeShortcuts.launchIntent(activity,-1)==null&&HomeShortcuts.launchIntent(activity,1)==null,"missing apps and browsers reported");
  for(int d:new int[]{-1,1}){runOnMainSync(()->HomeShortcuts.open(activity,d));waitForIdleSync();android.view.accessibility.AccessibilityNodeInfo root=getUiAutomation(android.app.UiAutomation.FLAG_DONT_SUPPRESS_ACCESSIBILITY_SERVICES).getRootInActiveWindow();check(root!=null&&!root.findAccessibilityNodeInfosByText("Edit shortcut").isEmpty(),"missing target offers edit instead of crashing");sendKeyDownUpSync(android.view.KeyEvent.KEYCODE_BACK);waitForIdleSync();}
  clearShortcuts(activity);
 }
 void clearShortcuts(Activity a){android.content.SharedPreferences.Editor e=HomeShortcuts.prefs(a).edit();for(int d:new int[]{-1,1})for(String field:new String[]{"kind","label","target","browser"})e.remove(HomeShortcuts.key(d)+field);e.commit();}
 void gesture(HomeSwipeView v,MainActivity a,int x,int y,int ex,int ey,boolean cancel){runOnMainSync(()->{long t=android.os.SystemClock.uptimeMillis();touch(v,t,t,0,x,y,a);touch(v,t,t+30,2,(x+ex)/2,(y+ey)/2,a);touch(v,t,t+60,2,ex,ey,a);touch(v,t,t+90,cancel?3:1,ex,ey,a);});}
 void touch(HomeSwipeView v,long down,long time,int action,int x,int y,MainActivity a){android.view.MotionEvent e=android.view.MotionEvent.obtain(down,time,action,a.dp(x),a.dp(y),0);try{v.dispatchTouchEvent(e);}finally{e.recycle();}}
 void testAssistantLaunches(MainActivity activity) throws Exception {
  for(int d:new int[]{-1,1}){String pkg=d<0?"com.anthropic.claude":"com.openai.chatgpt";HomeShortcuts.save(activity,d,"app","Fixture",pkg,"");Intent launch=HomeShortcuts.launchIntent(activity,d);check(launch!=null&&pkg.equals(launch.getComponent().getPackageName()),"correct assistant package");runOnMainSync(()->HomeShortcuts.open(activity,d));waitForIdleSync();boolean found=false;long until=System.currentTimeMillis()+5000;while(System.currentTimeMillis()<until){android.view.accessibility.AccessibilityNodeInfo root=getUiAutomation(android.app.UiAutomation.FLAG_DONT_SUPPRESS_ACCESSIBILITY_SERVICES).getRootInActiveWindow();if(root!=null&&pkg.contentEquals(root.getPackageName())){found=true;break;}Thread.sleep(100);}check(found,"assistant fixture opened");NexusAdmin.makeHome(activity);shell("am start -a android.intent.action.MAIN -c android.intent.category.HOME");waitForIdleSync();android.view.accessibility.AccessibilityNodeInfo returned=getUiAutomation(android.app.UiAutomation.FLAG_DONT_SUPPRESS_ACCESSIBILITY_SERVICES).getRootInActiveWindow();check(returned!=null&&activity.getPackageName().contentEquals(returned.getPackageName()),"Home returns to Nexus");}
  HomeShortcuts.save(activity,-1,"web","Browser fixture","https://example.com/custom?q=1","com.example.nexusbrowser");Intent web=HomeShortcuts.launchIntent(activity,-1);check(web!=null&&"com.example.nexusbrowser".equals(web.getPackage())&&"https://example.com/custom?q=1".equals(web.getDataString()),"website uses selected browser with exact URL");runOnMainSync(()->HomeShortcuts.open(activity,-1));waitForIdleSync();android.view.accessibility.AccessibilityNodeInfo browserRoot=getUiAutomation(android.app.UiAutomation.FLAG_DONT_SUPPRESS_ACCESSIBILITY_SERVICES).getRootInActiveWindow();check(browserRoot!=null&&"com.example.nexusbrowser".contentEquals(browserRoot.getPackageName()),"browser fixture actually opened");clearShortcuts(activity);
  Bundle out=new Bundle();out.putString("stream","PASS assistant installed-package launch and Home return (disposable fixtures, not real accounts)\n");finish(Activity.RESULT_OK,out);
 }
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
