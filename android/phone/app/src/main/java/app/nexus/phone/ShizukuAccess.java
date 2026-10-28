package app.nexus.phone;
import android.content.*;
import android.content.pm.PackageManager;
import android.os.*;
import java.util.concurrent.*;
import rikka.shizuku.Shizuku;
final class ShizukuAccess {
 static boolean ready(){try{return Shizuku.pingBinder()&&!Shizuku.isPreV11()&&Shizuku.getVersion()>=13&&Shizuku.checkSelfPermission()==PackageManager.PERMISSION_GRANTED;}catch(Exception e){return false;}}
 static String status(){try{if(!Shizuku.pingBinder())return "Stopped or not installed";return ready()?"Ready (UID "+Shizuku.getUid()+")":"Start Shizuku v13+ and grant Nexus permission";}catch(Exception e){return "Unavailable";}}
 static void request(){if(!Shizuku.pingBinder())throw new IllegalStateException("Start Shizuku first.");if(Shizuku.getVersion()<13)throw new IllegalStateException("Shizuku v13 or newer is required.");Shizuku.requestPermission(21);}
 static void run(Context c,String op,String arg,java.util.function.BooleanSupplier allowed) throws Exception {
  if(!ready())throw new IllegalStateException("Start Shizuku and grant Nexus permission on the phone.");
  if(!c.getSharedPreferences(PhoneApi.PREFS,0).getBoolean("deeper_tools",false))throw new IllegalStateException("Enable deeper tools on Nexus Home first.");
  CompletableFuture<IBinder> f=new CompletableFuture<>();
  ServiceConnection conn=new ServiceConnection(){public void onServiceConnected(ComponentName n,IBinder b){f.complete(b);}public void onServiceDisconnected(ComponentName n){f.completeExceptionally(new IllegalStateException("Shizuku disconnected."));}};
  Shizuku.UserServiceArgs args=new Shizuku.UserServiceArgs(new ComponentName(c,PrivilegedService.class)).daemon(false).tag("nexus-playground").version(2).processNameSuffix("playground");
  try{Shizuku.bindUserService(args,conn);IBinder binder=f.get(5,TimeUnit.SECONDS);
   if(!allowed.getAsBoolean())throw new IllegalStateException("Session stopped or command expired.");
   Parcel in=Parcel.obtain(),out=Parcel.obtain();try{in.writeInterfaceToken(PrivilegedService.DESCRIPTOR);in.writeString(op);in.writeString(arg);if(!binder.transact(IBinder.FIRST_CALL_TRANSACTION,in,out,0))throw new IllegalStateException("Privileged service unavailable.");out.readException();if(out.readInt()!=1)throw new IllegalStateException("Operation refused.");}finally{in.recycle();out.recycle();}
  }finally{try{Shizuku.unbindUserService(args,conn,true);}catch(Exception ignored){}}
 }
}
