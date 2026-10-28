package app.nexus.phone;
import android.app.admin.*;
import android.content.*;
public final class NexusAdmin extends DeviceAdminReceiver {
 static ComponentName component(Context c){return new ComponentName(c,NexusAdmin.class);}
 static boolean owner(Context c){return c.getSystemService(DevicePolicyManager.class).isDeviceOwnerApp(c.getPackageName());}
 static void makeHome(Context c){
  if(!owner(c))throw new IllegalStateException("Device-owner provisioning is required.");
  IntentFilter f=new IntentFilter(Intent.ACTION_MAIN);f.addCategory(Intent.CATEGORY_HOME);f.addCategory(Intent.CATEGORY_DEFAULT);
  c.getSystemService(DevicePolicyManager.class).addPersistentPreferredActivity(component(c),f,new ComponentName(c,MainActivity.class));
 }
 static void releaseHome(Context c){if(owner(c))c.getSystemService(DevicePolicyManager.class).clearPackagePersistentPreferredActivities(component(c),c.getPackageName());}
 @Override public void onProfileProvisioningComplete(Context c,Intent i){c.startActivity(new Intent(c,MainActivity.class).addFlags(Intent.FLAG_ACTIVITY_NEW_TASK));}
}
