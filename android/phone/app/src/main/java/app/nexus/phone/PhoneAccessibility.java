package app.nexus.phone;
import android.accessibilityservice.*;
import android.view.accessibility.*;
import android.app.KeyguardManager;
import android.content.*;
import android.graphics.*;
import android.hardware.HardwareBuffer;
import android.os.*;
import android.util.Base64;
import java.io.ByteArrayOutputStream;
import java.util.concurrent.*;
import org.json.*;
public final class PhoneAccessibility extends AccessibilityService {
 static volatile PhoneAccessibility instance;
 private final Handler ui=new Handler(Looper.getMainLooper());
 private String frameId="";private long frameAt;private int frameW,frameH;
 @Override protected void onServiceConnected(){instance=this;}
 @Override public void onAccessibilityEvent(AccessibilityEvent e){}
 @Override public void onInterrupt(){BridgeService.active=false;}
 @Override public void onDestroy(){instance=null;BridgeService.active=false;super.onDestroy();}
 private boolean allowed(JSONObject cmd){return BridgeService.active&&System.currentTimeMillis()<cmd.optLong("expires_at")&&!getSystemService(KeyguardManager.class).isDeviceLocked();}
 private JSONObject error(String s){try{return new JSONObject().put("ok",false).put("error",s);}catch(Exception e){return new JSONObject();}}
 private void done(CompletableFuture<JSONObject> f,boolean ok,String err){try{f.complete(ok?new JSONObject().put("ok",true):error(err));}catch(Exception e){f.complete(error("Could not complete action."));}}
 JSONObject execute(JSONObject cmd,String session) throws Exception {
  String action=cmd.getJSONObject("input").getString("action");JSONObject result;
  if(DeviceTools.handles(action)){
   try{result=DeviceTools.execute(this,cmd.getJSONObject("input"),()->BridgeService.isCurrent(session)&&allowed(cmd));}catch(Exception e){return error(e.getMessage()==null?"Device operation failed.":e.getMessage());}
  }else result=executeOne(cmd,session);
  if(result.optBoolean("ok")&&!cmd.getJSONObject("input").optBoolean("sensitive",false)&&!"screen".equals(action)&&!"device_info".equals(action)&&!"list_apps".equals(action)){
   // One action, then one observation. A capture failure must never imply the action failed.
   Thread.sleep(650);
   JSONObject capture=new JSONObject(cmd.toString());capture.put("input",new JSONObject().put("action","screen"));JSONObject image=executeOne(capture,session);
   if(image.optBoolean("ok")){result.put("image_base64",image.getString("image_base64")).put("width",image.getInt("width")).put("height",image.getInt("height"));}
   else result.put("screen_error",image.optString("error","Request a fresh screen before continuing."));
  }
  return result;
 }
 private JSONObject executeOne(JSONObject cmd,String session) throws Exception {
  CompletableFuture<JSONObject> future=new CompletableFuture<>();
  ui.post(()->{try{
   if(future.isDone()||!BridgeService.isCurrent(session)||!allowed(cmd)){future.complete(error("Disconnected, expired command, or phone locked."));return;}
   JSONObject in=cmd.getJSONObject("input");String action=in.getString("action");
   android.util.DisplayMetrics metrics=new android.util.DisplayMetrics();getSystemService(android.view.WindowManager.class).getDefaultDisplay().getRealMetrics(metrics);
   if(in.has("frame_id")&&(!frameId.equals(in.getString("frame_id"))||SystemClock.elapsedRealtime()-frameAt>30000||frameW!=metrics.widthPixels||frameH!=metrics.heightPixels)){future.complete(error("Screenshot is stale or display rotated. Request a fresh screen."));return;}
   if("screen".equals(action)){
    takeScreenshot(android.view.Display.DEFAULT_DISPLAY,getMainExecutor(),new TakeScreenshotCallback(){
     public void onSuccess(ScreenshotResult r){HardwareBuffer buffer=r.getHardwareBuffer();Bitmap hardware=null,copy=null,small=null;try{
      if(future.isDone()||!BridgeService.isCurrent(session)||!allowed(cmd)){future.complete(error("Screen request stopped."));return;}
      hardware=Bitmap.wrapHardwareBuffer(buffer,r.getColorSpace());if(hardware==null)throw new Exception();copy=hardware.copy(Bitmap.Config.ARGB_8888,false);
      float scale=Math.min(1f,Math.min(720f/copy.getWidth(),1600f/copy.getHeight()));small=Bitmap.createScaledBitmap(copy,Math.max(1,Math.round(copy.getWidth()*scale)),Math.max(1,Math.round(copy.getHeight()*scale)),true);
      ByteArrayOutputStream bytes=new ByteArrayOutputStream();small.compress(Bitmap.CompressFormat.JPEG,65,bytes);if(bytes.size()>330000){bytes.reset();small.compress(Bitmap.CompressFormat.JPEG,35,bytes);}if(bytes.size()>330000)throw new Exception();
      frameId=cmd.getString("id");frameAt=SystemClock.elapsedRealtime();frameW=copy.getWidth();frameH=copy.getHeight();
      future.complete(new JSONObject().put("ok",true).put("image_base64",Base64.encodeToString(bytes.toByteArray(),Base64.NO_WRAP)).put("width",small.getWidth()).put("height",small.getHeight()));
     }catch(Exception e){future.complete(error("Could not capture this screen."));}finally{if(small!=null&&small!=copy)small.recycle();if(copy!=null)copy.recycle();if(hardware!=null)hardware.recycle();buffer.close();}}
     public void onFailure(int code){future.complete(error("Screen capture unavailable (protected screen or Android error "+code+")."));}
    });return;
   }
   if("tap".equals(action)||"swipe".equals(action)){
    Path path=new Path();float x=(float)in.getDouble("x")*(metrics.widthPixels-1),y=(float)in.getDouble("y")*(metrics.heightPixels-1);path.moveTo(x,y);
    if("swipe".equals(action))path.lineTo((float)in.getDouble("to_x")*(metrics.widthPixels-1),(float)in.getDouble("to_y")*(metrics.heightPixels-1));
    GestureDescription gesture=new GestureDescription.Builder().addStroke(new GestureDescription.StrokeDescription(path,0,"tap".equals(action)?70:in.optInt("duration_ms",400))).build();
    boolean accepted=dispatchGesture(gesture,new GestureResultCallback(){public void onCompleted(GestureDescription d){done(future,true,"");}public void onCancelled(GestureDescription d){done(future,false,"Gesture cancelled.");}},ui);
    if(!accepted)future.complete(error("Android refused the gesture."));return;
   }
   if("type".equals(action)){
    AccessibilityNodeInfo root=getRootInActiveWindow(),focus=null;try{focus=root==null?null:root.findFocus(AccessibilityNodeInfo.FOCUS_INPUT);if(focus==null||!focus.isEditable()){future.complete(error("Tap an editable field first."));return;}if(focus.isPassword()&&!in.optBoolean("sensitive",false)){future.complete(error("Password fields require sensitive:true for authorized credential entry."));return;}Bundle args=new Bundle();args.putCharSequence(AccessibilityNodeInfo.ACTION_ARGUMENT_SET_TEXT_CHARSEQUENCE,in.getString("text"));done(future,focus.performAction(AccessibilityNodeInfo.ACTION_SET_TEXT,args),"This app does not support setting text.");}finally{if(focus!=null)focus.recycle();if(root!=null)root.recycle();}return;
   }
   if("back".equals(action)||"home".equals(action)){done(future,performGlobalAction("home".equals(action)?GLOBAL_ACTION_HOME:GLOBAL_ACTION_BACK),"Android refused navigation.");return;}
   if("open_nexus".equals(action)){startActivity(new Intent(Intent.ACTION_VIEW,android.net.Uri.parse(PhoneApi.ORIGIN+DeviceTools.nexusPath(in.getString("view")))).addFlags(Intent.FLAG_ACTIVITY_NEW_TASK));done(future,true,"");return;}
   if("recents".equals(action)||"notifications".equals(action)){done(future,performGlobalAction("recents".equals(action)?GLOBAL_ACTION_RECENTS:GLOBAL_ACTION_NOTIFICATIONS),"Android refused navigation.");return;}
   if("open_app".equals(action)){Intent launch=getPackageManager().getLaunchIntentForPackage(in.getString("package_name"));if(launch==null){future.complete(error("App is not installed or cannot be launched."));return;}launch.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK);startActivity(launch);done(future,true,"");return;}
   future.complete(error("Unsupported command."));
  }catch(Exception e){future.complete(error("Android could not perform this action."));}});
  try{return future.get(8,TimeUnit.SECONDS);}catch(TimeoutException e){JSONObject out=error("Action timed out; its outcome may be uncertain. Inspect a fresh screen.");future.complete(out);return out;}
 }
}
