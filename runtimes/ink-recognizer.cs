// DesignCraft local Windows Ink text bridge. No network or capture devices.
using System;
using System.Collections;
using System.Collections.Generic;
using System.Globalization;
using System.Reflection;
using System.Runtime.InteropServices;
using System.Text;
using System.Web.Script.Serialization;

internal static class DesignCraftInk {
    static readonly JavaScriptSerializer Json = new JavaScriptSerializer { MaxJsonLength = 50331648, RecursionLimit = 32 };
    static object Call(object target, string name, params object[] args) { return target.GetType().InvokeMember(name, BindingFlags.InvokeMethod, null, target, args, CultureInfo.InvariantCulture); }
    static object Get(object target, string name) { return target.GetType().InvokeMember(name, BindingFlags.GetProperty, null, target, null, CultureInfo.InvariantCulture); }
    static void Set(object target, string name, object value) { target.GetType().InvokeMember(name, BindingFlags.SetProperty, null, target, new object[] { value }, CultureInfo.InvariantCulture); }
    static object Com(string clsid) { Type type = Type.GetTypeFromCLSID(new Guid(clsid), true); return Activator.CreateInstance(type); }
    static void Release(object item) { if (item != null && Marshal.IsComObject(item)) { try { Marshal.FinalReleaseComObject(item); } catch { } } }
    static string Required(Dictionary<string,object> data,string key) { object v; if (!data.TryGetValue(key,out v) || !(v is string)) throw new ArgumentException("missing " + key); return (string)v; }
    [STAThread]
    static int Main() {
        Console.InputEncoding = new UTF8Encoding(false, true);
        Console.OutputEncoding = new UTF8Encoding(false);
        object ink = null, context = null;
        try {
            string raw = Console.In.ReadToEnd(); if (raw.Length == 0 || raw.Length > 1048576) throw new ArgumentException("ink input exceeds limit");
            var input = Json.Deserialize<Dictionary<string,object>>(raw); string mode = Required(input,"mode");
            if (mode != "text") throw new ArgumentException("unknown recognition mode");
            object source; if (!input.TryGetValue("strokes",out source) || !(source is IEnumerable)) throw new ArgumentException("missing real ink strokes");
            ink = Com("937C1A34-151D-4610-9CA6-A8CC9BDB5D83"); int count = 0, total = 0;
            foreach (object stroke in (IEnumerable)source) {
                if (++count > 256 || !(stroke is IEnumerable)) throw new ArgumentException("ink stroke limit");
                var packet = new List<int>();
                foreach (object point in (IEnumerable)stroke) {
                    if (++total > 20000 || !(point is IEnumerable)) throw new ArgumentException("ink point limit");
                    var coordinates = new List<double>(); foreach(object coordinate in (IEnumerable)point) { if(coordinates.Count >= 3) break; coordinates.Add(Convert.ToDouble(coordinate,CultureInfo.InvariantCulture)); }
                    if(coordinates.Count < 2) throw new ArgumentException("invalid point");
                    for(int j=0;j<2;j++) { double v=coordinates[j]; if(Double.IsNaN(v)||Double.IsInfinity(v)||Math.Abs(v)>1000000)throw new ArgumentException("invalid coordinate"); packet.Add(checked((int)Math.Round(v*2540.0/72.0))); }
                }
                if(packet.Count<4)throw new ArgumentException("each stroke needs two points");
                // IInkDisp reserves PacketDescription and requires VT_EMPTY,
                // not the missing-argument VT_ERROR used for optional COM args.
                Release(Call(ink,"CreateStroke",packet.ToArray(),null));
            }
            if(count==0)throw new ArgumentException("no ink selected");
            context=Com("AAC46A37-9229-4FC0-8CCE-4497569BF4D1"); Set(context,"Strokes",Get(ink,"Strokes"));
            object[] recognitionArguments = new object[] { 0 };
            object result=context.GetType().InvokeMember("Recognize",BindingFlags.InvokeMethod,null,context,recognitionArguments,CultureInfo.InvariantCulture);
            try { if(result==null)throw new InvalidOperationException("Windows returned no recognition result"); string text=Convert.ToString(Get(result,"TopString"),CultureInfo.InvariantCulture); if(String.IsNullOrWhiteSpace(text)||text.Length>40000)throw new InvalidOperationException("Windows returned empty or oversized text");
                Console.Write(Json.Serialize(new {ok=true,mode="text",text=text,alternatives=new string[]{text},engine="Windows Ink",strokes=count,recognitionStatus=Convert.ToInt32(recognitionArguments[0],CultureInfo.InvariantCulture)})); return 0;
            } finally { Release(result); }
        } catch(Exception error) {
            string detail=error is COMException?"Windows handwriting component unavailable or rejected the strokes":error is TargetInvocationException?"Windows handwriting operation failed":error.Message;
            Console.Write(Json.Serialize(new {ok=false,error=detail}));return 1;
        } finally { Release(context);Release(ink); }
    }
}
