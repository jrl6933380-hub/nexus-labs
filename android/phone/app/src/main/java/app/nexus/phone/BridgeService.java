package app.nexus.phone;
import android.app.*;
import android.os.*;
import android.content.*;
import android.content.pm.ServiceInfo;
import java.util.UUID;
import org.json.*;
public final class BridgeService extends Service {
 static volatile boolean active=false;static volatile String message="Disconnected.";
 private Thread worker;private volatile String session="";
 static volatile String currentSession="";
 static boolean isCurrent(String id){return active&&currentSession.equals(id);}
 @Override public IBinder onBind(Intent i){return null;}
 @Override public int onStartCommand(Intent intent,int flags,int startId){
  if(intent==null||"STOP".equals(intent.getAction())){active=false;message="Disconnected.";if(worker!=null)worker.interrupt();stopForeground(STOP_FOREGROUND_REMOVE);stopSelf();return START_NOT_STICKY;}
  if(active)return START_NOT_STICKY;
  NotificationManager nm=getSystemService(NotificationManager.class);nm.createNotificationChannel(new NotificationChannel("phone_control","Nexus phone control",NotificationManager.IMPORTANCE_LOW));
  PendingIntent stop=PendingIntent.getService(this,1,new Intent(this,BridgeService.class).setAction("STOP"),PendingIntent.FLAG_IMMUTABLE|PendingIntent.FLAG_UPDATE_CURRENT);
  PendingIntent open=PendingIntent.getActivity(this,2,new Intent(this,MainActivity.class),PendingIntent.FLAG_IMMUTABLE|PendingIntent.FLAG_UPDATE_CURRENT);
  Notification n=new Notification.Builder(this,"phone_control").setSmallIcon(android.R.drawable.ic_menu_view).setContentTitle("Nexus Phone connected").setContentText("Your Nexus account can view and control this phone. Tap Disconnect to stop.").setContentIntent(open).setOngoing(true).addAction(new Notification.Action.Builder(null,"Disconnect",stop).build()).build();
  if(Build.VERSION.SDK_INT>=34)startForeground(7,n,ServiceInfo.FOREGROUND_SERVICE_TYPE_SPECIAL_USE);else startForeground(7,n);
  active=true;session=UUID.randomUUID().toString();currentSession=session;worker=new Thread(()->loop(session),"nexus-phone");worker.start();return START_NOT_STICKY;
 }
 private void loop(String current){String token="";try{
  token=PhoneApi.token(this);if(token.isEmpty())throw new Exception("Pair this phone first.");
  PhoneApi.post(token,new JSONObject().put("action","start").put("session_id",current));message="Connected. Waiting for a Nexus command.";
  while(active&&session.equals(current)){
   JSONObject poll=PhoneApi.post(token,new JSONObject().put("action","poll").put("session_id",current).put("accessibility",PhoneAccessibility.instance!=null));
   if(!poll.optBoolean("active")){message="Stopped from Nexus.";break;}
   JSONObject cmd=poll.optJSONObject("command");
   if(cmd!=null&&active&&session.equals(current)){
    message="Running: "+cmd.getJSONObject("input").optString("action");JSONObject result;
    PhoneAccessibility access=PhoneAccessibility.instance;
    if(access==null)result=new JSONObject().put("ok",false).put("error","Accessibility service is not enabled.");
    else result=access.execute(cmd,current);
    // Never replay a command after a transport failure; the outcome may already have happened.
    if(active&&session.equals(current))PhoneApi.post(token,new JSONObject().put("action","complete").put("session_id",current).put("command_id",cmd.getString("id")).put("result",result));
    message="Connected. Last action: "+(result.optBoolean("ok")?"completed":"failed");
   }
   Thread.sleep(2000);
  }
 }catch(InterruptedException e){message="Disconnected.";}catch(Exception e){message="Disconnected: "+e.getMessage();}
 finally{if(session.equals(current)){active=false;try{if(!token.isEmpty())PhoneApi.post(token,new JSONObject().put("action","disconnect").put("session_id",current));}catch(Exception ignored){}stopForeground(STOP_FOREGROUND_REMOVE);stopSelf();}}
 }
 @Override public void onDestroy(){active=false;if(worker!=null)worker.interrupt();super.onDestroy();}
}
