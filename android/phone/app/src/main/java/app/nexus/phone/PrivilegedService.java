package app.nexus.phone;
import android.os.*;
import android.content.Context;
import java.util.concurrent.TimeUnit;
/** Shizuku starts this Binder as shell/root. It exposes two fixed operations, never a shell. */
public final class PrivilegedService extends Binder {
 static final String DESCRIPTOR="app.nexus.phone.Playground";
 private final int appUid;
 public PrivilegedService(Context context) throws Exception {appUid=context.getPackageManager().getApplicationInfo("app.nexus.phone",0).uid;attachInterface(null,DESCRIPTOR);}
 @Override protected boolean onTransact(int code,Parcel data,Parcel reply,int flags) throws RemoteException {
  if(code==INTERFACE_TRANSACTION){reply.writeString(DESCRIPTOR);return true;}
  if(code==16777115){if(Binder.getCallingUid()!=appUid&&Binder.getCallingUid()!=2000&&Binder.getCallingUid()!=0)throw new SecurityException();System.exit(0);return true;}
  if(code!=FIRST_CALL_TRANSACTION)return super.onTransact(code,data,reply,flags);
  if(Binder.getCallingUid()!=appUid)throw new SecurityException("Nexus app only.");data.enforceInterface(DESCRIPTOR);
  try{String[] args=PlaygroundPolicy.command(data.readString(),data.readString());
   java.lang.Process p=new ProcessBuilder(args).redirectOutput(new java.io.File("/dev/null")).redirectError(new java.io.File("/dev/null")).start();
   if(!p.waitFor(3,TimeUnit.SECONDS)){p.destroyForcibly();throw new IllegalStateException("Operation timed out; inspect state before retrying.");}
   if(p.exitValue()!=0)throw new IllegalStateException("Android refused the operation.");reply.writeNoException();reply.writeInt(1);
  }catch(Exception e){reply.writeException(new IllegalStateException(e.getMessage()));}return true;
 }
}
