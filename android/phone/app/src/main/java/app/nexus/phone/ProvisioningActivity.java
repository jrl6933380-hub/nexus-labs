package app.nexus.phone;
import android.app.*;
import android.app.admin.DevicePolicyManager;
import android.content.*;
import android.os.Bundle;
import android.widget.*;
public final class ProvisioningActivity extends Activity {
 @Override public void onCreate(Bundle b){super.onCreate(b);
  if(DevicePolicyManager.ACTION_GET_PROVISIONING_MODE.equals(getIntent().getAction())){
   java.util.ArrayList<Integer> allowed=getIntent().getIntegerArrayListExtra(DevicePolicyManager.EXTRA_PROVISIONING_ALLOWED_PROVISIONING_MODES);
   if(allowed!=null&&!allowed.contains(DevicePolicyManager.PROVISIONING_MODE_FULLY_MANAGED_DEVICE)){setResult(RESULT_CANCELED);finish();return;}
   setResult(RESULT_OK,new Intent().putExtra(DevicePolicyManager.EXTRA_PROVISIONING_MODE,DevicePolicyManager.PROVISIONING_MODE_FULLY_MANAGED_DEVICE));finish();return;
  }
  LinearLayout l=new LinearLayout(this);l.setOrientation(1);l.setPadding(28,40,28,28);
  TextView t=new TextView(this);t.setText("Nexus playground phone\n\nThis phone is managed by your Nexus build. Remote control still requires pairing and a visible Connect session. You can access Android Settings and Nexus recovery from Home.");t.setTextSize(20);l.addView(t);
  Button done=new Button(this);done.setText("Finish setup");done.setOnClickListener(v->{setResult(RESULT_OK);finish();});l.addView(done);setContentView(l);
 }
}
