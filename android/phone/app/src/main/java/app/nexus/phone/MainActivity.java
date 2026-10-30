package app.nexus.phone;
import android.app.*;
import android.app.role.RoleManager;
import android.os.*;
import android.content.*;
import android.content.pm.*;
import android.provider.Settings;
import android.graphics.Color;
import android.graphics.Typeface;
import android.graphics.drawable.GradientDrawable;
import android.view.*;
import android.widget.*;
import org.json.*;
public final class MainActivity extends Activity {
 private static final int BG=0xff0e1412,FG=0xfff5efe0,GOLD=0xffe8c36a,MUTED=0xff9aa59b,CARD=0xff172019,LINE=0xff2a3a30;
 View phoneAnchor;
 TextView state;EditText code;Button pair;LinearLayout layout;ScrollView scroll;HomeSwipeView assistantHome;Button leftShortcut,rightShortcut;TextView swipeHint;final Handler ui=new Handler(Looper.getMainLooper());
 final Runnable refresh=new Runnable(){public void run(){if(state!=null)state.setText((BridgeService.active?"● CONNECTED":"○ DISCONNECTED")+"\n"+BridgeService.message+"\nControl: "+(PhoneAccessibility.instance!=null?"ready":"enable accessibility")+" · Management: "+(NexusAdmin.owner(MainActivity.this)?"device owner":"standard app")+"\nShizuku: "+ShizukuAccess.status());ui.postDelayed(this,1500);}};
 @Override public void onCreate(Bundle b){super.onCreate(b);getWindow().setStatusBarColor(BG);getWindow().setNavigationBarColor(BG);render();routeIntent(getIntent());}
 void render(){
  scroll=new ScrollView(this);scroll.setFillViewport(true);scroll.setBackgroundColor(BG);layout=new LinearLayout(this);layout.setOrientation(1);int p=dp(22);layout.setPadding(p,dp(20),p,dp(36));scroll.addView(layout);
  LinearLayout shell=new LinearLayout(this);shell.setOrientation(1);shell.setFitsSystemWindows(true);shell.setBackgroundColor(BG);shell.addView(scroll,new LinearLayout.LayoutParams(-1,0,1f));View rule=new View(this);rule.setBackgroundColor(LINE);shell.addView(rule,new LinearLayout.LayoutParams(-1,dp(1)));shell.addView(tabBar(),new LinearLayout.LayoutParams(-1,-2));setContentView(shell);
  LinearLayout root=layout;assistantHome=new HomeSwipeView(this,direction->HomeShortcuts.open(this,direction));root.addView(assistantHome,new LinearLayout.LayoutParams(-1,-2));layout=assistantHome;
  TextView eyebrow=text("Nexus phone lab");eyebrow.setTextColor(GOLD);eyebrow.setTextSize(13);
  TextView title=text("Your Nexus.\nYour playground.");title.setTextSize(34);title.setTypeface(Typeface.SERIF,Typeface.NORMAL);
  swipeHint=text("");swipeHint.setTextColor(GOLD);
  leftShortcut=button("",()->HomeShortcuts.open(this,-1));rightShortcut=button("",()->HomeShortcuts.open(this,1));refreshShortcutLabels();
  text("Nexus is your center. Press Android Home to return here.").setTextColor(MUTED);
  layout=root;
  button("Swipe shortcuts",()->HomeShortcuts.settings(this,()->refreshShortcutLabels()));
  state=text("");state.setTextColor(MUTED);state.setTextSize(14);state.setBackground(rounded(CARD,16,LINE));state.setPadding(dp(16),dp(14),dp(16),dp(14));
  button("Connect phone",()->connect());button("Disconnect",()->stop());
  section("WORKSPACE");button("Open Nexus",()->openNexus("home"));button("Ad Studio",()->openNexus("ads"));button("Agent Board",()->openNexus("board"));button("Apps",()->showApps());
  phoneAnchor=section("PHONE SETUP");button("Set Nexus as Home",()->{try{if(NexusAdmin.owner(this))NexusAdmin.makeHome(this);else{RoleManager rm=getSystemService(RoleManager.class);if(rm.isRoleAvailable(RoleManager.ROLE_HOME))startActivityForResult(rm.createRequestRoleIntent(RoleManager.ROLE_HOME),31);else startActivity(new Intent(Settings.ACTION_HOME_SETTINGS));}}catch(Exception e){notice(e.getMessage());}});
  button("Enable screen and touch control",()->startActivity(new Intent(Settings.ACTION_ACCESSIBILITY_SETTINGS)));
  text("If Android 13 blocks accessibility: App info → three-dot menu → Allow restricted settings. Keep the phone unlocked for control.").setTextColor(MUTED);
  Switch deeper=new Switch(this);deeper.setText("Enable deeper tools");deeper.setTextColor(FG);deeper.setMinHeight(dp(54));deeper.setChecked(getSharedPreferences(PhoneApi.PREFS,0).getBoolean("deeper_tools",false));deeper.setOnCheckedChangeListener((v,on)->getSharedPreferences(PhoneApi.PREFS,0).edit().putBoolean("deeper_tools",on).apply());layout.addView(deeper);
  text("Deeper tools allow requested brightness changes, keeping a managed phone awake while charging, and force-stopping downloaded apps. Shizuku is needed for brightness and force-stop.").setTextColor(MUTED);
  button("Install / update Shizuku",()->browse("https://shizuku.rikka.app/download/"));button("Open Shizuku",()->{Intent i=getPackageManager().getLaunchIntentForPackage("moe.shizuku.privileged.api");if(i==null)notice("Install Shizuku from its official download page first.");else startActivity(i);});
  button("Authorize Nexus in Shizuku",()->{try{ShizukuAccess.request();}catch(Exception e){notice(e.getMessage());}});
  text("Start Shizuku through wireless debugging, then authorize Nexus. On a non-root phone it needs starting again after reboot. Nexus remote control still needs Connect.").setTextColor(MUTED);
  section("PRIVATE PAIRING");button("Open pairing page",()->openNexus("phone"));
  text("Create a five-minute pairing code on your Nexus owner page. Pairing replaces the previous phone.").setTextColor(MUTED);
  code=new EditText(this);code.setTextColor(FG);code.setHintTextColor(MUTED);code.setHint("18-character pairing code");code.setSingleLine(true);code.setMinHeight(dp(54));code.setInputType(android.text.InputType.TYPE_CLASS_TEXT|android.text.InputType.TYPE_TEXT_FLAG_CAP_CHARACTERS);layout.addView(code);
  pair=button("Pair this phone",()->pair());
  section("RECOVERY");button("Android Settings",()->startActivity(new Intent(Settings.ACTION_SETTINGS)));
  button("Release Nexus Home",()->{try{NexusAdmin.releaseHome(this);startActivity(new Intent(Settings.ACTION_HOME_SETTINGS));}catch(Exception e){notice(e.getMessage());}});
  button("Forget phone pairing",()->new AlertDialog.Builder(this).setTitle("Forget pairing?").setMessage("Stops this session and removes the phone credential. You can pair again from Nexus.").setNegativeButton("Cancel",null).setPositiveButton("Forget",(d,w)->{stop();getSharedPreferences(PhoneApi.PREFS,0).edit().remove("credential").putBoolean("deeper_tools",false).apply();BridgeService.message="Pairing removed. Revoke it on the owner page too.";}).show());
  button("Release device management",()->new AlertDialog.Builder(this).setTitle("Release management?").setMessage("Stops remote control and releases Nexus device-owner management without wiping your files. You will need provisioning again to restore device-owner mode.").setNegativeButton("Cancel",null).setPositiveButton("Release",(d,w)->{try{stop();getSharedPreferences(PhoneApi.PREFS,0).edit().putBoolean("deeper_tools",false).apply();NexusAdmin.releaseHome(this);if(NexusAdmin.owner(this))getSystemService(android.app.admin.DevicePolicyManager.class).clearDeviceOwnerApp(getPackageName());notice("Management released. You can choose another Home in Settings.");}catch(Exception e){notice("Could not release management: "+e.getMessage());}}).show());
  text("Nexus Phone 0.3.0 · Android stays underneath. No remote factory reset, password entry or unrestricted shell. Disconnect remains available in the notification and here. No remote session restarts automatically after reboot.").setTextColor(MUTED);
 }
 @Override protected void onNewIntent(Intent intent){super.onNewIntent(intent);setIntent(intent);routeIntent(intent);}
 void routeIntent(Intent intent){
  android.net.Uri uri=intent==null?null:intent.getData();
  if(uri!=null&&"nexusphone".equals(uri.getScheme())&&"connect".equals(uri.getHost())){
   code.post(()->{code.requestFocus();code.requestRectangleOnScreen(new android.graphics.Rect(0,0,code.getWidth(),code.getHeight()),true);getSystemService(android.view.inputmethod.InputMethodManager.class).showSoftInput(code,android.view.inputmethod.InputMethodManager.SHOW_IMPLICIT);});
  }else if(intent!=null&&intent.hasCategory(Intent.CATEGORY_HOME)){
   code.clearFocus();getSystemService(android.view.inputmethod.InputMethodManager.class).hideSoftInputFromWindow(code.getWindowToken(),0);scroll.post(()->scroll.scrollTo(0,0));
  }
 }
 void stop(){BridgeService.active=false;startService(new Intent(this,BridgeService.class).setAction("STOP"));}
 void connect(){try{if(PhoneApi.token(this).isEmpty()){notice("Pair this phone first.");return;}if(PhoneAccessibility.instance==null){notice("Enable screen and touch control first.");return;}if(Build.VERSION.SDK_INT>=33&&checkSelfPermission(android.Manifest.permission.POST_NOTIFICATIONS)!=PackageManager.PERMISSION_GRANTED){requestPermissions(new String[]{android.Manifest.permission.POST_NOTIFICATIONS},11);return;}startForegroundService(new Intent(this,BridgeService.class).setAction("CONNECT"));}catch(Exception e){notice("Could not connect: "+e.getMessage());}}
 void pair(){if(BridgeService.active){notice("Disconnect before changing pairing.");return;}String value=code.getText().toString().trim();pair.setEnabled(false);new Thread(()->{try{JSONObject r=PhoneApi.post(null,new JSONObject().put("action","pair").put("code",value).put("label",Build.MANUFACTURER+" "+Build.MODEL));PhoneApi.saveToken(this,r.getString("token"));runOnUiThread(()->{code.setText("");BridgeService.message="Paired. Enable control, then Connect.";});}catch(Exception e){BridgeService.message="Pairing failed: "+e.getMessage();}finally{runOnUiThread(()->pair.setEnabled(true));}}).start();}
 void openNexus(String v){browse(PhoneApi.ORIGIN+DeviceTools.nexusPath(v));}
 void browse(String url){try{startActivity(new Intent(Intent.ACTION_VIEW,android.net.Uri.parse(url)));}catch(ActivityNotFoundException e){notice("Install a browser to open Nexus pages.");}}
 void showApps(){try{JSONArray a=DeviceTools.apps(this).getJSONArray("apps");String[] labels=new String[a.length()];for(int i=0;i<labels.length;i++)labels[i]=a.getJSONObject(i).getString("label");new AlertDialog.Builder(this).setTitle("Open an app").setItems(labels,(d,n)->{try{Intent i=getPackageManager().getLaunchIntentForPackage(a.getJSONObject(n).getString("package_name"));if(i!=null)startActivity(i);}catch(Exception e){notice("App unavailable.");}}).setNegativeButton("Close",null).show();}catch(Exception e){notice("Could not list apps.");}}
 int dp(int n){return Math.round(n*getResources().getDisplayMetrics().density);}
 TextView text(String s){TextView t=new TextView(this);t.setText(s);t.setTextColor(FG);t.setTextSize(16);t.setPadding(0,dp(8),0,dp(10));layout.addView(t);return t;}
 TextView section(String s){TextView t=text(s);t.setTextSize(13);t.setTextColor(GOLD);t.setPadding(0,dp(28),0,dp(8));return t;}
 GradientDrawable rounded(int fill,int radiusDp,int stroke){GradientDrawable g=new GradientDrawable();g.setColor(fill);g.setCornerRadius(dp(radiusDp));g.setStroke(dp(1),stroke);return g;}
 View tabBar(){LinearLayout bar=new LinearLayout(this);bar.setOrientation(0);bar.setBackgroundColor(BG);bar.setPadding(0,dp(6),0,dp(6));
  bar.addView(tab("Home",GOLD,()->scroll.smoothScrollTo(0,0)),new LinearLayout.LayoutParams(0,-2,1f));
  bar.addView(tab("Board",MUTED,()->openNexus("boards")),new LinearLayout.LayoutParams(0,-2,1f));
  bar.addView(tab("Phone",MUTED,()->{if(phoneAnchor!=null)scroll.smoothScrollTo(0,phoneAnchor.getTop());}),new LinearLayout.LayoutParams(0,-2,1f));
  bar.addView(tab("Swipes",MUTED,()->HomeShortcuts.settings(this,()->refreshShortcutLabels())),new LinearLayout.LayoutParams(0,-2,1f));
  return bar;}
 TextView tab(String s,int color,Runnable r){TextView t=new TextView(this);t.setText(s);t.setTextSize(13);t.setTextColor(color);t.setGravity(Gravity.CENTER);t.setMinHeight(dp(52));t.setOnClickListener(v->r.run());return t;}
 Button button(String s,Runnable r){Button b=new Button(this);b.setText(s);b.setTextSize(16);b.setTextColor(FG);b.setAllCaps(false);b.setGravity(Gravity.CENTER_VERTICAL|Gravity.START);b.setPadding(dp(16),0,dp(16),0);b.setMinHeight(dp(54));GradientDrawable bg=new GradientDrawable();bg.setColor(CARD);bg.setCornerRadius(dp(14));bg.setStroke(dp(1),LINE);b.setBackground(bg);b.setOnClickListener(v->r.run());LinearLayout.LayoutParams lp=new LinearLayout.LayoutParams(-1,-2);lp.bottomMargin=dp(8);layout.addView(b,lp);return b;}
 void notice(String s){Toast.makeText(this,s,Toast.LENGTH_LONG).show();}
 void refreshShortcutLabels(){if(leftShortcut!=null){leftShortcut.setText("← "+HomeShortcuts.label(this,-1));rightShortcut.setText(HomeShortcuts.label(this,1)+" →");swipeHint.setText("Swipe left: "+HomeShortcuts.label(this,-1)+" · Swipe right: "+HomeShortcuts.label(this,1));}}
 @Override protected void onResume(){super.onResume();refreshShortcutLabels();ui.removeCallbacks(refresh);ui.post(refresh);}
 @Override protected void onPause(){super.onPause();ui.removeCallbacks(refresh);}
}
