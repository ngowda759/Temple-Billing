// pages/StaffDashboard.jsx
// The staff member's OWN dashboard after they log in
// Plugs into your existing authService.js + LoginPage.jsx flow

import { useState, useEffect } from "react";
import { useNavigate } from "react-router-dom";
// ⬇ adjust this import path to match your authService
// ── Mock data (replace with real API calls) ───────────────────
const mockProfile = {
 name: "Mohan Das",
 role: "Cashier",
 department: "Front Desk",
 email: "mohan@temple.org",
 phone: "9731122334",
 shift: "Afternoon",
 salary: 20000,
 attendance: 89,
 status: "Active",
 joinDate: "20 Jul 2023",
 leaveBalance: 8,
 avatar: "MD",
};

const weekDays = [
 {day:"Mon",date:"12",s:"P"},{day:"Tue",date:"13",s:"P"},
 {day:"Wed",date:"14",s:"P"},{day:"Thu",date:"15",s:"A"},
 {day:"Fri",date:"16",s:"P"},{day:"Sat",date:"17",s:"P"},
 {day:"Sun",date:"18",s:"H"},
];

const payHistory = [
 {month:"May 2026",amount:20000,paid:true,date:"01 May"},
 {month:"Apr 2026",amount:20000,paid:true,date:"01 Apr"},
 {month:"Mar 2026",amount:20000,paid:true,date:"01 Mar"},
];

const roleColors = {
 Priest: {bg:"#FFF7ED",text:"#C2410C"},
 Accountant: {bg:"#EFF6FF",text:"#1D4ED8"},
 Cashier: {bg:"#F0FDF4",text:"#15803D"},
 "Temple Staff": {bg:"#FDF4FF",text:"#7E22CE"},
};

// ── Tab button ────────────────────────────────────────────────
function Tab({label,icon,active,onClick}){
 return(
 <button onClick={onClick} style={{
 padding:"9px 16px", borderRadius:10, border:"none", cursor:"pointer",
 fontSize:13, fontWeight:600, display:"flex", alignItems:"center", gap:6,
 background: active?"linear-gradient(135deg,#F97316,#EA580C)":"transparent",
 color: active?"#fff":"#9CA3AF",
 }}>{icon} {label}</button>
 );
}

// ── Change Password section ───────────────────────────────────
function ChangePassword(){
 const [form, setForm] = useState({current:"",next:"",confirm:""});
 const [show, setShow] = useState({current:false,next:false,confirm:false});
 const [errors,setErrors]= useState({});
 const [ok,setOk] = useState(false);
 const [busy,setBusy] = useState(false);

 function strength(pw){
 let s=0;
 if(pw.length>=8) s++;
 if(/[A-Z]/.test(pw)) s++;
 if(/[0-9]/.test(pw)) s++;
 if(/[^A-Za-z0-9]/.test(pw)) s++;
 return s;
 }

 function validate(){
 const e={};
 if(!form.current) e.current ="Enter your current password";
 if(form.next.length<8) e.next ="Minimum 8 characters";
 if(!/[A-Z]/.test(form.next)) e.next ="Must include an uppercase letter";
 if(!/[0-9]/.test(form.next)) e.next ="Must include a number";
 if(form.next!==form.confirm) e.confirm ="Passwords do not match";
 setErrors(e);
 return !Object.keys(e).length;
 }

 function handleSubmit(){
 if(!validate()) return;
 setBusy(true);
 // 🔌 Replace with real API call:
 // await authService.changePassword(form.current, form.next)
 setTimeout(()=>{
 setBusy(false); setOk(true);
 setForm({current:"",next:"",confirm:""});
 setTimeout(()=>setOk(false),4000);
 },1200);
 }

 const s = strength(form.next);
 const sColor=["","#EF4444","#F59E0B","#3B82F6","#16A34A"][s];
 const sLabel=["","Weak","Fair","Good","Strong"][s];

 const PwInput=({f,label,placeholder})=>(
 <div style={{display:"flex",flexDirection:"column",gap:5}}>
 <label style={{fontSize:13,fontWeight:600,color:"#374151"}}>{label}</label>
 <div style={{position:"relative"}}>
 <input
 type={show[f]?"text":"password"}
 value={form[f]}
 placeholder={placeholder}
 onChange={e=>setForm({...form,[f]:e.target.value})}
 style={{
 width:"100%",boxSizing:"border-box",
 padding:"10px 42px 10px 13px",borderRadius:9,
 border:`1.5px solid ${errors[f]?"#EF4444":"#E5E7EB"}`,
 fontSize:14,color:"#111827",outline:"none",
 }}
 />
 <button type="button" onClick={()=>setShow(s=>({...s,[f]:!s[f]}))} style={{
 position:"absolute",right:11,top:"50%",transform:"translateY(-50%)",
 background:"none",border:"none",cursor:"pointer",fontSize:16,color:"#9CA3AF",
 }}>{show[f]?"🙈":"👁"}</button>
 </div>
 {errors[f]&&<span style={{fontSize:12,color:"#EF4444"}}>{errors[f]}</span>}
 </div>
 );

 return(
 <div style={{display:"flex",flexDirection:"column",gap:18}}>
 <div style={{background:"#F9FAFB",borderRadius:12,padding:16}}>
 <div style={{fontSize:15,fontWeight:700,color:"#111827"}}>🔐 Change Password</div>
 <div style={{fontSize:13,color:"#6B7280",marginTop:3}}>Keep your account safe with a strong password.</div>
 </div>

 {ok&&(
 <div style={{background:"#F0FDF4",border:"1px solid #BBF7D0",borderRadius:11,padding:"13px 16px",display:"flex",gap:10}}>
 <span style={{fontSize:20}}>✅</span>
 <div>
 <div style={{fontSize:14,fontWeight:700,color:"#15803D"}}>Password changed!</div>
 <div style={{fontSize:12,color:"#16A34A"}}>Use your new password next time you log in.</div>
 </div>
 </div>
 )}

 <PwInput f="current" label="Current Password" placeholder="Enter current password" />
 <PwInput f="next" label="New Password" placeholder="At least 8 characters" />

 {/* strength bar */}
 {form.next&&(
 <div style={{display:"flex",flexDirection:"column",gap:5}}>
 <div style={{display:"flex",gap:4}}>
 {[1,2,3,4].map(i=>(
 <div key={i} style={{flex:1,height:4,borderRadius:4,background:i<=s?sColor:"#E5E7EB"}} />
 ))}
 </div>
 <div style={{fontSize:12,fontWeight:600,color:sColor}}>{sLabel}</div>
 </div>
 )}

 <PwInput f="confirm" label="Confirm New Password" placeholder="Repeat new password" />

 {/* checklist */}
 <div style={{background:"#FFFBEB",border:"1px solid #FEF08A",borderRadius:11,padding:14}}>
 <div style={{fontSize:12,fontWeight:700,color:"#92400E",marginBottom:8}}>Requirements:</div>
 {[
 ["At least 8 characters", form.next.length>=8],
 ["One uppercase letter (A–Z)", /[A-Z]/.test(form.next)],
 ["One number (0–9)", /[0-9]/.test(form.next)],
 ["Passwords match", !!form.next&&form.next===form.confirm],
 ].map(([txt,met])=>(
 <div key={txt} style={{display:"flex",gap:8,alignItems:"center",marginBottom:4}}>
 <span style={{fontSize:14,color:met?"#16A34A":"#D1D5DB"}}>{met?"✓":"○"}</span>
 <span style={{fontSize:12,color:met?"#15803D":"#9CA3AF"}}>{txt}</span>
 </div>
 ))}
 </div>

 <button onClick={handleSubmit} disabled={busy} style={{
 width:"100%",padding:"12px 0",borderRadius:11,border:"none",
 background:busy?"#FED7AA":"linear-gradient(135deg,#F97316,#EA580C)",
 fontSize:15,fontWeight:700,color:"#fff",cursor:busy?"not-allowed":"pointer",
 }}>
 {busy?"Changing…":"🔒 Change Password"}
 </button>
 </div>
 );
}

// ── Main component ────────────────────────────────────────────
export default function StaffDashboard(){
 const navigate = useNavigate();
 const [tab,setTab]= useState("overview");

 // In real app: pull from authService / JWT
 // const user = getCurrentUser();
 const emp = mockProfile;

 const rc = roleColors[emp.role] ?? roleColors["Temple Staff"];
 const avatarBg = "#F97316"; // or getAvatarColor(emp.name)

 function handleLogout(){
 // logout(); // call your authService logout
 navigate("/");
 }

 return(
 <div style={{minHeight:"100vh",background:"#FFFBF5",fontFamily:"'Segoe UI',sans-serif"}}>

 {/* Header */}
 <div style={{background:"linear-gradient(135deg,#F97316,#EA580C)",padding:"24px 24px 72px"}}>
 <div style={{display:"flex",justifyContent:"space-between",alignItems:"center"}}>
 <div>
 <div style={{fontSize:13,color:"#FED7AA"}}>Employee Portal</div>
 <div style={{fontSize:20,fontWeight:800,color:"#fff"}}>My Dashboard</div>
 </div>
 <button onClick={handleLogout} style={{
 background:"rgba(255,255,255,0.2)",border:"none",borderRadius:10,
 padding:"8px 16px",fontSize:13,fontWeight:600,color:"#fff",cursor:"pointer",
 }}>Logout →</button>
 </div>
 </div>

 <div style={{maxWidth:860,margin:"-52px auto 0",padding:"0 20px"}}>

 {/* Profile card */}
 <div style={{
 background:"#fff",borderRadius:18,padding:"22px 24px",
 boxShadow:"0 8px 30px rgba(249,115,22,0.13)",
 display:"flex",alignItems:"center",gap:18,flexWrap:"wrap",marginBottom:20,
 }}>
 <div style={{
 width:70,height:70,borderRadius:"50%",background:avatarBg,flexShrink:0,
 display:"flex",alignItems:"center",justifyContent:"center",
 fontSize:24,fontWeight:800,color:"#fff",border:"4px solid #FFF7ED",
 }}>{emp.avatar}</div>

 <div style={{flex:1,minWidth:160}}>
 <div style={{fontSize:19,fontWeight:800,color:"#111827"}}>{emp.name}</div>
 <div style={{display:"flex",gap:8,marginTop:5,flexWrap:"wrap"}}>
 <span style={{fontSize:12,fontWeight:600,padding:"3px 11px",borderRadius:20,background:rc.bg,color:rc.text}}>{emp.role}</span>
 <span style={{fontSize:12,padding:"3px 11px",borderRadius:20,background:"#F0FDF4",color:"#15803D"}}>● {emp.status}</span>
 </div>
 <div style={{fontSize:12,color:"#6B7280",marginTop:5}}>
 {emp.department} · {emp.shift} Shift · Joined {emp.joinDate}
 </div>
 </div>

 <div style={{display:"grid",gridTemplateColumns:"1fr 1fr",gap:10}}>
 <div style={{background:"#FFF7ED",borderRadius:11,padding:"10px 14px",textAlign:"center"}}>
 <div style={{fontSize:17,fontWeight:800,color:"#F97316"}}>₹{(emp.salary/1000).toFixed(0)}K</div>
 <div style={{fontSize:11,color:"#9CA3AF"}}>Monthly</div>
 </div>
 <div style={{background:"#F0FDF4",borderRadius:11,padding:"10px 14px",textAlign:"center"}}>
 <div style={{fontSize:17,fontWeight:800,color:"#16A34A"}}>{emp.attendance}%</div>
 <div style={{fontSize:11,color:"#9CA3AF"}}>Attendance</div>
 </div>
 </div>
 </div>

 {/* Tabs */}
 <div style={{
 background:"#fff",border:"1px solid #F3E8D0",borderRadius:13,
 padding:5,display:"flex",gap:3,marginBottom:18,flexWrap:"wrap",
 }}>
 {[
 {id:"overview", icon:"📋", label:"Overview"},
 {id:"attendance", icon:"📅", label:"Attendance"},
 {id:"payroll", icon:"💰", label:"Payroll"},
 {id:"password", icon:"🔐", label:"Change Password"},
 ].map(t=>(
 <Tab key={t.id} {...t} active={tab===t.id} onClick={()=>setTab(t.id)} />
 ))}
 </div>

 {/* Tab panel */}
 <div style={{
 background:"#fff",border:"1px solid #F3E8D0",borderRadius:16,
 padding:24,marginBottom:40,
 }}>

 {/* ── Overview ── */}
 {tab==="overview"&&(
 <div style={{display:"flex",flexDirection:"column",gap:18}}>
 <div style={{fontSize:15,fontWeight:700,color:"#111827"}}>Personal Information</div>
 <div style={{display:"grid",gridTemplateColumns:"1fr 1fr",gap:12}}>
 {[
 {icon:"👤",label:"Full Name", val:emp.name},
 {icon:"📧",label:"Email", val:emp.email},
 {icon:"📞",label:"Phone", val:emp.phone},
 {icon:"🏢",label:"Department", val:emp.department},
 {icon:"🎭",label:"Role", val:emp.role},
 {icon:"⏱",label:"Shift", val:emp.shift+" Shift"},
 {icon:"📅",label:"Joined", val:emp.joinDate},
 {icon:"🏖",label:"Leave Balance",val:emp.leaveBalance+" days"},
 ].map(r=>(
 <div key={r.label} style={{background:"#F9FAFB",borderRadius:11,padding:"12px 14px"}}>
 <div style={{fontSize:11,color:"#9CA3AF",marginBottom:3}}>{r.icon} {r.label}</div>
 <div style={{fontSize:14,fontWeight:700,color:"#111827"}}>{r.val}</div>
 </div>
 ))}
 </div>
 </div>
 )}

 {/* ── Attendance ── */}
 {tab==="attendance"&&(
 <div style={{display:"flex",flexDirection:"column",gap:18}}>
 <div style={{fontSize:15,fontWeight:700,color:"#111827"}}>This Week</div>
 <div style={{display:"flex",gap:8}}>
 {weekDays.map(a=>(
 <div key={a.day} style={{flex:1,textAlign:"center"}}>
 <div style={{fontSize:11,color:"#9CA3AF",marginBottom:4}}>{a.day}</div>
 <div style={{fontSize:11,color:"#D1D5DB",marginBottom:4}}>{a.date}</div>
 <div style={{
 margin:"0 auto",width:36,height:36,borderRadius:8,
 display:"flex",alignItems:"center",justifyContent:"center",
 fontWeight:800,fontSize:13,
 background:a.s==="P"?"#DCFCE7":a.s==="A"?"#FEE2E2":"#F3F4F6",
 color:a.s==="P"?"#16A34A":a.s==="A"?"#DC2626":"#9CA3AF",
 }}>{a.s}</div>
 </div>
 ))}
 </div>

 {/* legend */}
 <div style={{display:"flex",gap:14,flexWrap:"wrap"}}>
 {[["P","Present","#DCFCE7","#16A34A"],["A","Absent","#FEE2E2","#DC2626"],["H","Holiday","#F3F4F6","#9CA3AF"]].map(([k,l,bg,c])=>(
 <div key={k} style={{display:"flex",alignItems:"center",gap:7}}>
 <div style={{width:26,height:26,borderRadius:6,background:bg,display:"flex",alignItems:"center",justifyContent:"center",fontSize:12,fontWeight:800,color:c}}>{k}</div>
 <span style={{fontSize:13,color:"#6B7280"}}>{l}</span>
 </div>
 ))}
 </div>

 {/* May summary */}
 <div style={{background:"#F9FAFB",borderRadius:13,padding:16}}>
 <div style={{fontSize:14,fontWeight:700,color:"#374151",marginBottom:12}}>May 2026 Summary</div>
 <div style={{display:"grid",gridTemplateColumns:"1fr 1fr 1fr",gap:12}}>
 {[["Present","17","#16A34A"],["Absent","2","#DC2626"],["Holidays","2","#6B7280"]].map(([l,v,c])=>(
 <div key={l} style={{textAlign:"center"}}>
 <div style={{fontSize:22,fontWeight:800,color:c}}>{v}</div>
 <div style={{fontSize:12,color:"#9CA3AF"}}>{l}</div>
 </div>
 ))}
 </div>
 </div>
 </div>
 )}

 {/* ── Payroll ── */}
 {tab==="payroll"&&(
 <div style={{display:"flex",flexDirection:"column",gap:16}}>
 <div style={{fontSize:15,fontWeight:700,color:"#111827"}}>Salary & Payments</div>
 <div style={{
 background:"linear-gradient(135deg,#F97316,#EA580C)",
 borderRadius:14,padding:"18px 22px",color:"#fff",
 }}>
 <div style={{fontSize:12,color:"#FED7AA"}}>Monthly CTC</div>
 <div style={{fontSize:30,fontWeight:800,margin:"5px 0"}}>₹{emp.salary.toLocaleString()}</div>
 <div style={{fontSize:12,color:"#FFDDB8"}}>Next payout: 01 Jun 2026</div>
 </div>
 <div style={{fontSize:14,fontWeight:700,color:"#374151"}}>Payment History</div>
 {payHistory.map(p=>(
 <div key={p.month} style={{
 display:"flex",justifyContent:"space-between",alignItems:"center",
 background:"#F9FAFB",borderRadius:11,padding:"13px 16px",
 }}>
 <div>
 <div style={{fontSize:14,fontWeight:700,color:"#111827"}}>{p.month}</div>
 <div style={{fontSize:12,color:"#9CA3AF"}}>Paid on {p.date}</div>
 </div>
 <div style={{display:"flex",alignItems:"center",gap:10}}>
 <span style={{fontSize:15,fontWeight:800,color:"#F97316"}}>₹{p.amount.toLocaleString()}</span>
 <span style={{fontSize:12,fontWeight:600,padding:"3px 11px",borderRadius:20,background:"#DCFCE7",color:"#15803D"}}>✓ Paid</span>
 </div>
 </div>
 ))}
 </div>
 )}

 {/* ── Change Password ── */}
 {tab==="password"&&<ChangePassword />}

 </div>
 </div>
 </div>
 );
}