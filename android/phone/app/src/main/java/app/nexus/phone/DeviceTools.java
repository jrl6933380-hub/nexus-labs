package app.nexus.phone;
import android.content.*;
import android.content.pm.*;
import android.app.admin.DevicePolicyManager;
import android.os.*;
import org.json.*;
import java.util.*;
final class DeviceTools {
 static String nexusPath(String view){switch(view){case "home":return "/workspace.html";case "ads":return "/ad-maker.html";case "board":return "/agent-board.html";case "boards":return "/board.html";case "phone":return "/workspace.html?view=phone";default:throw new IllegalArgumentException("Unknown Nexus view.");}}
 static JSONObject info(Context c) throws Exception {return new JSONObject().put("version","0.3.0").put("manufacturer",Build.MANUFACTURER).put("model",Build.MODEL).put("android",Build.VERSION.RELEASE).put("sdk",Build.VERSION.SDK_INT).put("device_owner",NexusAdmin.owner(c)).put("shizuku_ready",ShizukuAccess.ready()).put("deeper_tools",c.getSharedPreferences(PhoneApi.PREFS,0).getBoolean("deeper_tools",false)).put("action_screenshots",true);}
 static JSONObject apps(Context c) throws Exception {
  List<ResolveInfo> list=c.getPackageManager().queryIntentActivities(new Intent(Intent.ACTION_MAIN).addCategory(Intent.CATEGORY_LAUNCHER),0);
  list.sort((a,b)->a.loadLabel(c.getPackageManager()).toString().compareToIgnoreCase(b.loadLabel(c.getPackageManager()).toString()));
  JSONArray apps=new JSONArray();Set<String> seen=new HashSet<>();for(ResolveInfo r:list){if(apps.length()>=150)break;String p=r.activityInfo.packageName;if(seen.add(p))apps.put(new JSONObject().put("package_name",p).put("label",r.loadLabel(c.getPackageManager()).toString().substring(0,Math.min(80,r.loadLabel(c.getPackageManager()).length()))));}
  return new JSONObject().put("apps",apps).put("truncated",seen.size()<list.size()&&apps.length()>=150);
 }
 static boolean handles(String a){return Arrays.asList("device_info","list_apps","brightness","stay_awake","force_stop").contains(a);}
 static JSONObject execute(Context c,JSONObject in,java.util.function.BooleanSupplier allowed) throws Exception {
  if(!allowed.getAsBoolean())throw new IllegalStateException("Session stopped, phone locked or command expired.");String a=in.getString("action");
  if("device_info".equals(a))return new JSONObject().put("ok",true).put("data",info(c));
  if("list_apps".equals(a))return new JSONObject().put("ok",true).put("data",apps(c));
  if(!c.getSharedPreferences(PhoneApi.PREFS,0).getBoolean("deeper_tools",false))throw new IllegalStateException("Enable deeper tools on Nexus Home first.");
  if("stay_awake".equals(a)){
   if(!NexusAdmin.owner(c))throw new IllegalStateException("Device-owner provisioning is required.");
   c.getSystemService(DevicePolicyManager.class).setGlobalSetting(NexusAdmin.component(c),android.provider.Settings.Global.STAY_ON_WHILE_PLUGGED_IN,in.getBoolean("enabled")?"7":"0");
  }else{
   String arg="brightness".equals(a)?Integer.toString(in.getInt("value")):in.getString("package_name");
   if("force_stop".equals(a)){
    ApplicationInfo app=c.getPackageManager().getApplicationInfo(arg,0);
    if(!PlaygroundPolicy.forceStopTarget(arg)||(app.flags&(ApplicationInfo.FLAG_SYSTEM|ApplicationInfo.FLAG_UPDATED_SYSTEM_APP))!=0)throw new IllegalArgumentException("Only downloaded apps outside Nexus and Shizuku can be force-stopped.");
    ResolveInfo home=c.getPackageManager().resolveActivity(new Intent(Intent.ACTION_MAIN).addCategory(Intent.CATEGORY_HOME),PackageManager.MATCH_DEFAULT_ONLY);
    if(home!=null&&arg.equals(home.activityInfo.packageName))throw new IllegalArgumentException("The current home app cannot be stopped.");
   }
   PlaygroundPolicy.command(a,arg);ShizukuAccess.run(c,a,arg,allowed);
  }
  return new JSONObject().put("ok",true);
 }
}
