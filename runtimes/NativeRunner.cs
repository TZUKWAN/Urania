using System;
using System.ComponentModel;
using System.Runtime.InteropServices;
using System.Text;

// Owns one headless engine process tree. Windows closes the job and kills its
// children when this hidden launcher is stopped, including forced termination.
internal static class NativeRunner {
  [StructLayout(LayoutKind.Sequential)] struct BasicLimits {
    public long ProcessUserTime, JobUserTime; public uint Flags;
    public UIntPtr MinWorkingSet,MaxWorkingSet;public uint ActiveProcesses;
    public UIntPtr Affinity;public uint PriorityClass,SchedulingClass;
  }
  [StructLayout(LayoutKind.Sequential)] struct IoCounters {
    public ulong ReadOps,WriteOps,OtherOps,ReadBytes,WriteBytes,OtherBytes;
  }
  [StructLayout(LayoutKind.Sequential)] struct Limits {
    public BasicLimits Basic;public IoCounters Io;public UIntPtr ProcessMemory,JobMemory,PeakProcess,PeakJob;
  }
  [StructLayout(LayoutKind.Sequential,CharSet=CharSet.Unicode)] struct Startup {
    public uint Size;public string Reserved,Desktop,Title;public uint X,Y,XSize,YSize,XChars,YChars,Fill,Flags;
    public ushort Show,ReservedSize;public IntPtr ReservedBytes,Stdin,Stdout,Stderr;
  }
  [StructLayout(LayoutKind.Sequential)] struct ProcessInfo {public IntPtr Process,Thread;public uint Pid,Tid;}
  [DllImport("kernel32.dll",CharSet=CharSet.Unicode,SetLastError=true)] static extern IntPtr CreateJobObject(IntPtr attributes,string name);
  [DllImport("kernel32.dll",SetLastError=true)] static extern bool SetInformationJobObject(IntPtr job,int kind,ref Limits value,uint size);
  [DllImport("kernel32.dll",SetLastError=true)] static extern bool AssignProcessToJobObject(IntPtr job,IntPtr process);
  [DllImport("kernel32.dll",CharSet=CharSet.Unicode,SetLastError=true)] static extern bool CreateProcess(string application,StringBuilder command,IntPtr processAttributes,IntPtr threadAttributes,bool inherit,uint flags,IntPtr environment,string directory,ref Startup startup,out ProcessInfo process);
  [DllImport("kernel32.dll")] static extern uint ResumeThread(IntPtr thread);
  [DllImport("kernel32.dll")] static extern uint WaitForSingleObject(IntPtr handle,uint timeout);
  [DllImport("kernel32.dll")] static extern bool GetExitCodeProcess(IntPtr process,out uint code);
  [DllImport("kernel32.dll")] static extern bool TerminateProcess(IntPtr process,uint code);
  [DllImport("kernel32.dll")] static extern bool CloseHandle(IntPtr handle);
  [DllImport("kernel32.dll")] static extern IntPtr GetStdHandle(int id);
  [DllImport("kernel32.dll",SetLastError=true)] static extern bool SetHandleInformation(IntPtr handle,uint mask,uint flags);
  static string Quote(string value) {
    var result=new StringBuilder("\"");int slashes=0;
    foreach(char c in value){if(c=='\\'){slashes++;continue;}if(c=='"'){result.Append('\\',slashes*2+1);result.Append(c);}else{result.Append('\\',slashes);result.Append(c);}slashes=0;}
    result.Append('\\',slashes*2);return result.Append('"').ToString();
  }
  static void Check(bool ok){if(!ok)throw new Win32Exception(Marshal.GetLastWin32Error());}
  static int Main(string[] args){
    IntPtr job=IntPtr.Zero;ProcessInfo process=new ProcessInfo();bool started=false;
    try{
      int memory;if(args.Length<4||args[0]!="--memory-mb"||!Int32.TryParse(args[1],out memory)||memory<64||memory>4096||args[2]!="--")throw new ArgumentException("Expected --memory-mb 64..4096 -- executable [args]");
      job=CreateJobObject(IntPtr.Zero,null);if(job==IntPtr.Zero)throw new Win32Exception(Marshal.GetLastWin32Error());
      var limits=new Limits();limits.Basic.Flags=0x2000|0x100|0x200|0x8;limits.Basic.ActiveProcesses=2;
      limits.ProcessMemory=(UIntPtr)((ulong)memory*1024*1024);limits.JobMemory=(UIntPtr)((ulong)(memory+256)*1024*1024);
      Check(SetInformationJobObject(job,9,ref limits,(uint)Marshal.SizeOf(typeof(Limits))));
      var command=new StringBuilder();for(int i=3;i<args.Length;i++){if(i>3)command.Append(' ');command.Append(Quote(args[i]));}
      var startup=new Startup();startup.Size=(uint)Marshal.SizeOf(typeof(Startup));startup.Flags=0x100;
      startup.Stdin=GetStdHandle(-10);startup.Stdout=GetStdHandle(-11);startup.Stderr=GetStdHandle(-12);
      foreach(IntPtr handle in new[]{startup.Stdin,startup.Stdout,startup.Stderr})Check(SetHandleInformation(handle,1,1));
      Check(CreateProcess(args[3],command,IntPtr.Zero,IntPtr.Zero,true,0x08000000|0x4,IntPtr.Zero,Environment.CurrentDirectory,ref startup,out process));started=true;
      Check(AssignProcessToJobObject(job,process.Process));
      if(ResumeThread(process.Thread)==0xffffffff)throw new Win32Exception(Marshal.GetLastWin32Error());
      Console.Error.WriteLine("[designcraft-runtime] pid="+process.Pid+" memoryMB="+memory);
      WaitForSingleObject(process.Process,0xffffffff);uint exitCode;Check(GetExitCodeProcess(process.Process,out exitCode));return unchecked((int)exitCode);
    }catch(Exception error){if(started)TerminateProcess(process.Process,125);Console.Error.WriteLine("[designcraft-runtime] "+error.Message);return 125;}
    finally{if(process.Thread!=IntPtr.Zero)CloseHandle(process.Thread);if(process.Process!=IntPtr.Zero)CloseHandle(process.Process);if(job!=IntPtr.Zero)CloseHandle(job);}
  }
}
