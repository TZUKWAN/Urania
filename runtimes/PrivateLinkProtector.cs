using System;
using System.Security.Cryptography;
using System.Text;

// Protects short-lived private links for the current Windows user only.
// Reads and writes base64 on redirected standard streams; never opens the link.
internal static class PrivateLinkProtector {
  static int Main(string[] args) {
    byte[] input=null,output=null,entropy=null;
    try {
      if(args.Length!=2 || (args[0]!="protect" && args[0]!="unprotect") || args[1].Length!=64) return 2;
      foreach(char c in args[1]) if(!((c>='0'&&c<='9')||(c>='a'&&c<='f'))) return 2;
      string line=Console.ReadLine();if(line==null || line.Length>32768) return 2;
      input=Convert.FromBase64String(line);if(input.Length==0 || input.Length>16384) return 2;
      entropy=Encoding.UTF8.GetBytes("DesignCraft/VeniceVideo/v1/"+args[1]);
      output=args[0]=="protect" ? ProtectedData.Protect(input,entropy,DataProtectionScope.CurrentUser) : ProtectedData.Unprotect(input,entropy,DataProtectionScope.CurrentUser);
      if(output.Length==0 || output.Length>16384) return 2;
      Console.Write(Convert.ToBase64String(output));return 0;
    } catch { Console.Error.Write("Private link protection failed.");return 1; }
    finally {if(input!=null)Array.Clear(input,0,input.Length);if(output!=null)Array.Clear(output,0,output.Length);if(entropy!=null)Array.Clear(entropy,0,entropy.Length);}
  }
}
