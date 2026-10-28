package app.nexus.phone;
import android.content.Context;
import android.view.MotionEvent;
import android.view.ViewConfiguration;
import android.widget.LinearLayout;
/** Horizontal gestures only in the Home hero. Vertical scrolling and ordinary taps stay native. */
public final class HomeSwipeView extends LinearLayout {
 private final int slop; private final float threshold; private float x,y; private boolean blocked,claimed;
 private final java.util.function.IntConsumer open;
 public HomeSwipeView(Context c,java.util.function.IntConsumer open){super(c);this.open=open;setOrientation(VERTICAL);slop=ViewConfiguration.get(c).getScaledTouchSlop();threshold=80*c.getResources().getDisplayMetrics().density;}
 @Override public boolean onInterceptTouchEvent(MotionEvent e){
  int a=e.getActionMasked();
  if(a==MotionEvent.ACTION_DOWN){x=e.getX();y=e.getY();blocked=false;claimed=false;}
  if(e.getPointerCount()!=1||a==MotionEvent.ACTION_CANCEL)blocked=true;
  if(a==MotionEvent.ACTION_MOVE&&!blocked){float dx=Math.abs(e.getX()-x),dy=Math.abs(e.getY()-y);
   if(dy>slop&&dy>=dx)blocked=true;
   else if(dx>slop*2&&dx>dy*1.8f){claimed=true;getParent().requestDisallowInterceptTouchEvent(true);return true;}
  }
  return claimed;
 }
 @Override public boolean onTouchEvent(MotionEvent e){
  int a=e.getActionMasked();if(e.getPointerCount()!=1||a==MotionEvent.ACTION_POINTER_DOWN||a==MotionEvent.ACTION_CANCEL)blocked=true;
  if(a==MotionEvent.ACTION_UP){float dx=e.getX()-x,dy=Math.abs(e.getY()-y);boolean launch=claimed&&!blocked&&Math.abs(dx)>=threshold&&Math.abs(dx)>dy*1.8f;claimed=false;getParent().requestDisallowInterceptTouchEvent(false);if(launch)open.accept(dx<0?-1:1);}
  return true;
 }
}
