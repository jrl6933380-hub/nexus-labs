package app.nexus.phone;
import android.app.*;
import android.os.*;
import android.content.*;
import android.provider.Settings;
import android.graphics.Color;
import android.view.*;
import android.widget.*;
import org.json.*;
public final class MainActivity extends Activity {
 TextView state;EditText code;Button pair,connect;final Handler ui=new Handler(Looper.getMainLooper());
 final Runnable refresh=new Runnable(){public void run(){if(state!=null)state.setText(BridgeService.message+"\nAccessibility: "+(PhoneAccessibility.instance!=null?"enabled":"not enabled"));ui.postDelayed(this,1000);}};
 @Override public void onCreate(Bundle b){super.onCreate(b);
  ScrollView scroll=new ScrollView(this);LinearLayout layout=new LinearLayout(this);layout.setOrientation(1);int pad=(int)(24*getResources().getDisplayMetrics().density);layout.setPadding(pad,pad,pad,pad);scroll.addView(layout);setContentView(scroll);
  TextView title=new TextView(this);title.setText("NEXUS / PHONE");title.setTextSize(28);title.setTextColor(Color.rgb(20,40,60));layout.addView(title);
  text(layout,"Connect this phone to your private Nexus tools. While connected, your Nexus account can view the screen and operate apps. Only connect when you want remote control. This prototype does not need root or Shizuku.");
  state=text(layout,"");state.setTextSize(18);
  text(layout,"Pairing code");
  code=new EditText(this);code.setHint("Paste your Nexus pairing code here");code.setSingleLine(true);code.setInputType(android.text.InputType.TYPE_CLASS_TEXT|android.text.InputType.TYPE_TEXT_FLAG_CAP_CHARACTERS);code.setMinHeight((int)(56*getResources().getDisplayMetrics().density));code.setBackgroundColor(Color.rgb(237,242,247));code.setTextColor(Color.rgb(20,40,60));code.setHintTextColor(Color.rgb(70,80,90));layout.addView(code);
  text(layout,"Create the code in Nexus → Phone, then paste it in the box above.");
  pair=button(layout,"2. Pair this TCL",()->{if(BridgeService.active){BridgeService.message="Disconnect before changing pairing.";return;}String value=code.getText().toString().trim();pair.setEnabled(false);new Thread(()->{try{JSONObject r=PhoneApi.post(null,new JSONObject().put("action","pair").put("code",value).put("label",Build.MANUFACTURER+" "+Build.MODEL));PhoneApi.saveToken(this,r.getString("token"));runOnUiThread(()->{code.setText("");BridgeService.message="Paired. Enable accessibility, then Connect.";});}catch(Exception e){BridgeService.message="Pairing failed: "+e.getMessage();}finally{runOnUiThread(()->pair.setEnabled(true));}}).start();});
  button(layout,"Open Phone in the main Nexus app",()->startActivity(new Intent(Intent.ACTION_VIEW,android.net.Uri.parse(PhoneApi.ORIGIN+"/workspace.html?view=phone"))));
  button(layout,"3. Enable Nexus Phone accessibility",()->startActivity(new Intent(Settings.ACTION_ACCESSIBILITY_SETTINGS)));
  text(layout,"Android 13 may require: Settings → Apps → Nexus Phone → three-dot menu → Allow restricted settings, before you can enable the accessibility service. Grant this only for the app you installed from your own Nexus build.");
  connect=button(layout,"4. Connect",()->{try{if(PhoneApi.token(this).isEmpty()){BridgeService.message="Pair this phone first.";return;}}catch(Exception e){BridgeService.message="Pair this phone again.";return;}if(PhoneAccessibility.instance==null){BridgeService.message="Enable Nexus Phone accessibility first.";return;}if(Build.VERSION.SDK_INT>=33&&checkSelfPermission(android.Manifest.permission.POST_NOTIFICATIONS)!=android.content.pm.PackageManager.PERMISSION_GRANTED){requestPermissions(new String[]{android.Manifest.permission.POST_NOTIFICATIONS},11);return;}startForegroundService(new Intent(this,BridgeService.class).setAction("CONNECT"));});
  button(layout,"DISCONNECT",()->{BridgeService.active=false;startService(new Intent(this,BridgeService.class).setAction("STOP"));});
  button(layout,"Forget pairing",()->{BridgeService.active=false;startService(new Intent(this,BridgeService.class).setAction("STOP"));getSharedPreferences(PhoneApi.PREFS,0).edit().clear().apply();BridgeService.message="Pairing removed on this phone. Revoke it on your Nexus page too.";});
  text(layout,"No automatic start after reboot. Keep this phone awake and unlocked for control. Password fields and protected screens are unavailable. You remain responsible for approving posts, purchases, messages and account changes. Closing a chat does not automatically disconnect the phone; use Disconnect when finished.");
 }
 TextView text(LinearLayout l,String s){TextView t=new TextView(this);t.setText(s);t.setTextSize(16);t.setPadding(0,14,0,14);l.addView(t);return t;}
 Button button(LinearLayout l,String s,Runnable r){Button b=new Button(this);b.setText(s);b.setAllCaps(false);b.setOnClickListener(v->r.run());l.addView(b,new LinearLayout.LayoutParams(-1,-2));return b;}
 @Override protected void onResume(){super.onResume();ui.post(refresh);}
 @Override protected void onPause(){super.onPause();ui.removeCallbacks(refresh);}
}
