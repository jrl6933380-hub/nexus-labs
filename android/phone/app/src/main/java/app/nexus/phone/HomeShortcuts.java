package app.nexus.phone;
import android.app.*;
import android.content.*;
import android.content.pm.*;
import android.net.Uri;
import android.widget.*;
import org.json.*;
import java.util.*;
/** Two local launch shortcuts. Never sends prompts, credentials or conversation context. */
public final class HomeShortcuts {
 static String key(int d){return d<0?"home_left_":"home_right_";}
 static android.content.SharedPreferences prefs(Context c){return c.getSharedPreferences(PhoneApi.PREFS,0);}
 static String value(Context c,int d,String field,String fallback){return prefs(c).getString(key(d)+field,fallback);}
 static String label(Context c,int d){return value(c,d,"label",d<0?"Claude":"ChatGPT");}
 static String kind(Context c,int d){return value(c,d,"kind","web");}
 static String target(Context c,int d){return value(c,d,"target",d<0?"https://claude.ai/":"https://chatgpt.com/");}
 static String browser(Context c,int d){return value(c,d,"browser","");}
 static String webUrl(String input){
  String s=input.trim();if(s.length()>2048)throw new IllegalArgumentException("Use a shorter website address.");
  try{java.net.URI u=new java.net.URI(s);String scheme=u.getScheme();if((!"https".equalsIgnoreCase(scheme)&&!"http".equalsIgnoreCase(scheme))||u.getHost()==null||u.getRawUserInfo()!=null)throw new Exception();return u.toASCIIString();}
  catch(Exception e){throw new IllegalArgumentException("Enter a full http:// or https:// website address without login credentials.");}
 }
 static void save(Context c,int d,String kind,String label,String target,String browser){
  if(!"web".equals(kind)&&!"app".equals(kind))throw new IllegalArgumentException("Choose Website or Installed app.");
  label=label.trim();if(label.isEmpty()||label.length()>48)throw new IllegalArgumentException("Use a name between 1 and 48 characters.");
  if("web".equals(kind))target=webUrl(target);else if(!target.matches("[A-Za-z0-9_]+(?:\\.[A-Za-z0-9_]+)+"))throw new IllegalArgumentException("Choose an installed app.");
  prefs(c).edit().putString(key(d)+"kind",kind).putString(key(d)+"label",label).putString(key(d)+"target",target).putString(key(d)+"browser",browser).apply();
 }
 static List<ResolveInfo> browsers(Context c){return c.getPackageManager().queryIntentActivities(new Intent(Intent.ACTION_VIEW,Uri.parse("https://example.com/")).addCategory(Intent.CATEGORY_BROWSABLE),PackageManager.MATCH_DEFAULT_ONLY);}
 static Intent launchIntent(Activity a,int d){
  if("app".equals(kind(a,d)))return a.getPackageManager().getLaunchIntentForPackage(target(a,d));
  Intent i=new Intent(Intent.ACTION_VIEW,Uri.parse(webUrl(target(a,d)))).addCategory(Intent.CATEGORY_BROWSABLE);
  String selected=browser(a,d);List<ResolveInfo> list=browsers(a);
  if(selected.isEmpty()){
   for(ResolveInfo r:list)if("com.android.chrome".equals(r.activityInfo.packageName)){selected=r.activityInfo.packageName;break;}
   if(selected.isEmpty()&&!list.isEmpty()){ResolveInfo preferred=a.getPackageManager().resolveActivity(new Intent(Intent.ACTION_VIEW,Uri.parse("https://example.com/")).addCategory(Intent.CATEGORY_BROWSABLE),PackageManager.MATCH_DEFAULT_ONLY);for(ResolveInfo r:list)if(preferred!=null&&r.activityInfo.packageName.equals(preferred.activityInfo.packageName))selected=r.activityInfo.packageName;if(selected.isEmpty())selected=list.get(0).activityInfo.packageName;}
  }
  for(ResolveInfo r:list)if(r.activityInfo.packageName.equals(selected))return i.setPackage(selected);
  return null;
 }
 static void open(Activity a,int d){
  try{Intent i=launchIntent(a,d);if(i!=null){a.startActivity(i);return;}}catch(ActivityNotFoundException|SecurityException|IllegalArgumentException ignored){}
  new AlertDialog.Builder(a).setTitle("Shortcut unavailable").setMessage("The app or browser for "+label(a,d)+" cannot be opened. Choose another installed app or browser in Swipe shortcuts.").setNegativeButton("Cancel",null).setPositiveButton("Edit shortcut",(dialog,w)->edit(a,d,()->{})).show();
 }
 static void settings(Activity a,Runnable changed){new AlertDialog.Builder(a).setTitle("Swipe shortcuts").setItems(new String[]{"Left · "+label(a,-1),"Right · "+label(a,1)},(dialog,which)->edit(a,which==0?-1:1,changed)).setNegativeButton("Close",null).show();}
 static void edit(Activity a,int d,Runnable changed){new AlertDialog.Builder(a).setTitle(d<0?"Left swipe":"Right swipe").setItems(new String[]{"Website in a browser","Installed app","Restore default"},(dialog,which)->{if(which==0)editWebsite(a,d,changed);else if(which==1)pickApp(a,d,changed);else{prefs(a).edit().remove(key(d)+"kind").remove(key(d)+"label").remove(key(d)+"target").remove(key(d)+"browser").apply();changed.run();}}).setNegativeButton("Cancel",null).show();}
 static void editWebsite(Activity a,int d,Runnable changed){
  LinearLayout form=new LinearLayout(a);form.setOrientation(1);int pad=Math.round(20*a.getResources().getDisplayMetrics().density);form.setPadding(pad,0,pad,0);
  EditText name=new EditText(a);name.setHint("Shortcut name");name.setSingleLine(true);name.setText(label(a,d));form.addView(name);
  EditText url=new EditText(a);url.setHint("https://example.com");url.setSingleLine(true);url.setInputType(android.text.InputType.TYPE_CLASS_TEXT|android.text.InputType.TYPE_TEXT_VARIATION_URI);url.setText("web".equals(kind(a,d))?target(a,d):"https://");form.addView(url);
  TextView heading=new TextView(a);heading.setText("Open with");form.addView(heading);Spinner picker=new Spinner(a);List<ResolveInfo> list=browsers(a);List<String> packages=new ArrayList<>(),labels=new ArrayList<>();packages.add("");labels.add("Automatic (prefer Chrome)");
  for(ResolveInfo r:list)if(!packages.contains(r.activityInfo.packageName)){packages.add(r.activityInfo.packageName);labels.add(r.loadLabel(a.getPackageManager()).toString());}
  String current=browser(a,d);if(!packages.contains(current)){packages.add(current);labels.add(current+" (unavailable)");}picker.setAdapter(new ArrayAdapter<String>(a,android.R.layout.simple_spinner_dropdown_item,labels));picker.setSelection(packages.indexOf(current));form.addView(picker);
  AlertDialog dialog=new AlertDialog.Builder(a).setTitle("Website shortcut").setView(form).setNegativeButton("Cancel",null).setPositiveButton("Save",null).create();dialog.setOnShowListener(v->dialog.getButton(AlertDialog.BUTTON_POSITIVE).setOnClickListener(button->{try{save(a,d,"web",name.getText().toString(),url.getText().toString(),packages.get(picker.getSelectedItemPosition()));changed.run();dialog.dismiss();}catch(IllegalArgumentException e){url.setError(e.getMessage());}}));dialog.show();
 }
 static void pickApp(Activity a,int d,Runnable changed){try{JSONArray apps=DeviceTools.apps(a).getJSONArray("apps");String[] labels=new String[apps.length()];for(int n=0;n<labels.length;n++)labels[n]=apps.getJSONObject(n).getString("label");new AlertDialog.Builder(a).setTitle("Choose installed app").setItems(labels,(dialog,n)->{try{JSONObject app=apps.getJSONObject(n);save(a,d,"app",app.getString("label").substring(0,Math.min(48,app.getString("label").length())),app.getString("package_name"),"");changed.run();}catch(Exception e){Toast.makeText(a,"App unavailable.",Toast.LENGTH_LONG).show();}}).setNegativeButton("Cancel",null).show();}catch(Exception e){Toast.makeText(a,"Could not list installed apps.",Toast.LENGTH_LONG).show();}}
 private HomeShortcuts(){}
}
