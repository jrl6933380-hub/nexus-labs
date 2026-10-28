package app.nexus.phone;
import android.content.Context;
import android.util.Base64;
import android.security.keystore.KeyGenParameterSpec;
import android.security.keystore.KeyProperties;
import java.net.URL;
import javax.net.ssl.HttpsURLConnection;
import java.io.*;
import java.nio.charset.StandardCharsets;
import java.security.KeyStore;
import javax.crypto.*;
import javax.crypto.spec.GCMParameterSpec;
import org.json.*;
final class PhoneApi {
 static final String ORIGIN="https://nexus-labs-sigma.vercel.app";
 static final String PREFS="nexus_phone";
 static javax.crypto.SecretKey key() throws Exception {
  KeyStore ks=KeyStore.getInstance("AndroidKeyStore");ks.load(null);
  if(!ks.containsAlias("nexus_phone_token")){
   KeyGenerator gen=KeyGenerator.getInstance(KeyProperties.KEY_ALGORITHM_AES,"AndroidKeyStore");
   gen.init(new KeyGenParameterSpec.Builder("nexus_phone_token",KeyProperties.PURPOSE_ENCRYPT|KeyProperties.PURPOSE_DECRYPT).setBlockModes(KeyProperties.BLOCK_MODE_GCM).setEncryptionPaddings(KeyProperties.ENCRYPTION_PADDING_NONE).build());gen.generateKey();
  }
  return (javax.crypto.SecretKey)ks.getKey("nexus_phone_token",null);
 }
 static void saveToken(Context c,String token) throws Exception {
  Cipher cipher=Cipher.getInstance("AES/GCM/NoPadding");cipher.init(Cipher.ENCRYPT_MODE,key());
  String value=Base64.encodeToString(cipher.getIV(),Base64.NO_WRAP)+":"+Base64.encodeToString(cipher.doFinal(token.getBytes(StandardCharsets.UTF_8)),Base64.NO_WRAP);
  if(!c.getSharedPreferences(PREFS,0).edit().putString("credential",value).commit())throw new IOException("Could not save phone pairing.");
 }
 static String token(Context c) throws Exception {
  String value=c.getSharedPreferences(PREFS,0).getString("credential","");if(value.isEmpty())return "";
  String[] parts=value.split(":",2);Cipher cipher=Cipher.getInstance("AES/GCM/NoPadding");cipher.init(Cipher.DECRYPT_MODE,key(),new GCMParameterSpec(128,Base64.decode(parts[0],Base64.NO_WRAP)));
  return new String(cipher.doFinal(Base64.decode(parts[1],Base64.NO_WRAP)),StandardCharsets.UTF_8);
 }
 static JSONObject post(String token,JSONObject body) throws Exception {
  HttpsURLConnection conn=(HttpsURLConnection)new URL(ORIGIN+"/api/phone").openConnection();
  conn.setInstanceFollowRedirects(false);conn.setConnectTimeout(10000);conn.setReadTimeout(12000);conn.setRequestMethod("POST");conn.setRequestProperty("Content-Type","application/json");if(token!=null&&!token.isEmpty())conn.setRequestProperty("Authorization","Bearer "+token);conn.setDoOutput(true);
  byte[] data=body.toString().getBytes(StandardCharsets.UTF_8);conn.setFixedLengthStreamingMode(data.length);
  try{try(OutputStream out=conn.getOutputStream()){out.write(data);}int status=conn.getResponseCode();InputStream stream=status<400?conn.getInputStream():conn.getErrorStream();if(stream==null)throw new IOException("Nexus returned HTTP "+status);
   ByteArrayOutputStream out=new ByteArrayOutputStream();try(InputStream in=stream){byte[] buf=new byte[8192];int n;while((n=in.read(buf))!=-1){if(out.size()+n>600000)throw new IOException("Response too large.");out.write(buf,0,n);}}
   JSONObject result=new JSONObject(out.toString("UTF-8"));if(status>=400)throw new IOException(result.optString("error","Nexus returned HTTP "+status));return result;
  }finally{conn.disconnect();}
 }
}
