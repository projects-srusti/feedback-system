// Vite + React 17+ uses the new JSX transform so you don't need the default React import.
// Import only the hooks you use.
import { useEffect, useMemo, useState } from "react";

import { BarChart, Bar, XAxis, YAxis, Tooltip, ResponsiveContainer } from "recharts";

// Student Feedback Monitor - Supabase-ready Demo (fixed)
// Safe environment variable detection and Supabase usage.

let viteEnv: Record<string, any> = {};
try {
  // Vite exposes import.meta.env in ESM; this is safe inside try/catch
  // @ts-ignore
  viteEnv = (import.meta as any).env ?? {};
} catch (e) {
  viteEnv = {};
}

// SAFE process.env access (only if process exists) — avoids "process is not defined" in browsers
// Use Vite's import.meta.env for environment variables
// Vite uses import.meta.env (not process.env)
const nodeEnv: Record<string, any> =
  typeof import.meta !== "undefined" && (import.meta as any).env
    ? (import.meta as any).env
    : {};


const SUPABASE_URL = String(viteEnv.VITE_SUPABASE_URL ?? nodeEnv.VITE_SUPABASE_URL ?? '');
const SUPABASE_ANON_KEY = String(viteEnv.VITE_SUPABASE_ANON_KEY ?? nodeEnv.VITE_SUPABASE_ANON_KEY ?? '');

// createSupabaseClientIfNeeded: dynamic import and return client or null
async function createSupabaseClientIfNeeded() {
  if (!SUPABASE_URL || !SUPABASE_ANON_KEY) return null;
  try {
    const mod = await import('@supabase/supabase-js');
    const { createClient } = mod as any;
    return createClient(SUPABASE_URL, SUPABASE_ANON_KEY);
  } catch (err) {
    console.warn('Could not dynamically import @supabase/supabase-js', err);
    return null;
  }
}

// types
type Program = "MBA" | "MCA";
type Semester = "I" | "II" | "III" | "IV";
type Role = "Admin" | "Teacher" | "Student" | "Coordinator";

interface FeedbackItem { subjectId: number; rating: number; comment?: string; }
interface Submission { id: number; studentId: number; program: Program; semester: Semester; isAnonymous: boolean; submittedAt: string; items: FeedbackItem[]; }
interface Subject { id: number; code: string; name: string; program: Program; semester: Semester; teacherId: number; }
interface User { id: number; name: string; email: string; program: Program; semester: Semester; role: Role; }

export default function StudentFeedbackMonitorDemo() {
  // supabase client will be created and stored in state if envs are available
  const [supabase, setSupabase] = useState<any>(null);
  const [isSupabaseReady, setIsSupabaseReady] = useState<boolean>(false);

  useEffect(() => {
    let mounted = true;
    createSupabaseClientIfNeeded().then(client => { if (mounted) { setSupabase(client); setIsSupabaseReady(!!client); } });
    return () => { mounted = false; };
  }, []);

  // Mock users
  const mockUsers: User[] = [
    { id: 1, name: "Amit Kumar", email: "amit@example.com", program: "MBA", semester: "I", role: "Student" },
    { id: 2, name: "Sneha Patel", email: "sneha@example.com", program: "MCA", semester: "II", role: "Student" },
    { id: 10, name: "Dr. Rao", email: "rao@college.edu", program: "MBA", semester: "I", role: "Teacher" },
  ];

  // Initial demo subjects removed for clean DB
  const initialSubjects: Subject[] = [];

  // App state
  const [subjects, setSubjects] = useState<Subject[]>(initialSubjects);
  const [nextSubjectId, setNextSubjectId] = useState<number>(1);

  const [submissions, setSubmissions] = useState<Submission[]>([]);

  const [currentRole, setCurrentRole] = useState<Role>("Admin");
  const [currentUser, setCurrentUser] = useState<User>(mockUsers[0]);

  useEffect(() => {
    if (currentRole === "Student") setCurrentUser(mockUsers[0]);
    else if (currentRole === "Teacher") setCurrentUser(mockUsers[2]);
    else setCurrentUser({ id: 99, name: "Admin Demo", email: "admin@demo", program: "MBA", semester: "I", role: currentRole });
  }, [currentRole]);

  // UI settings
  const [anonymousAllowed, setAnonymousAllowed] = useState<boolean>(true);
  const [allowEditUntilSubmit, setAllowEditUntilSubmit] = useState<boolean>(false);
  const [reminderLogs, setReminderLogs] = useState<string[]>([]);
  const [dark, setDark] = useState<boolean>(false);

  // helpers
  function subjectsFor(program: Program, semester: Semester) {
    return subjects.filter(s => s.program === program && s.semester === semester);
  }

  function exportCSVRows(rows: string[][], filename = 'export.csv'){
    // safe CSV creation
    const csv = rows
      .map(r => r.map(cell => `"${String(cell).replace(/"/g, '""') }"`).join(','))
      .join('\n');
    const blob = new Blob([csv], { type: 'text/csv' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url; a.download = filename; document.body.appendChild(a); a.click(); a.remove(); URL.revokeObjectURL(url);
  }

  // ---------- Supabase-aware CRUD (falls back to in-memory demo) ----------
  async function loadFromSupabase(){
    if (!supabase) return;
    try {
      const { data: subs, error: e1 } = await supabase.from('subjects').select('*');
      if (!e1 && subs) {
        // map DB rows (snake_case) to Subject interface (camelCase)
        const mappedSubjects: Subject[] = (subs as any[]).map(r => ({ id: r.id, code: r.code, name: r.name, program: r.program, semester: r.semester, teacherId: r.teacher_id }));
        setSubjects(mappedSubjects);
        // compute next id safely
        const maxId = mappedSubjects.reduce((m, s) => Math.max(m, s.id), 0);
        setNextSubjectId(maxId + 1);
      }

      const { data: sbs, error: e2 } = await supabase.from('submissions').select('*, feedback_items(*)');
      if (!e2 && sbs) {
        const mapped: Submission[] = (sbs as any[]).map(row => ({
          id: row.id,
          studentId: row.student_id ?? 0,
          program: row.program,
          semester: row.semester,
          isAnonymous: !!row.is_anonymous,
          submittedAt: row.submitted_at,
          items: (row.feedback_items || []).map((fi:any) => ({ subjectId: fi.subject_id, rating: fi.rating, comment: fi.comment }))
        }));
        setSubmissions(mapped);
      }

    } catch (err) {
      console.error('Supabase load error', err);
    }
  }

  useEffect(() => { loadFromSupabase(); /* eslint-disable-next-line react-hooks/exhaustive-deps */ }, [supabase]);

  // IMPORTANT: when inserting/updating via Supabase, convert camelCase -> snake_case where DB expects snake_case
  async function addSubject(subject: Omit<Subject, 'id'>) {
    if (supabase) {
      try {
        // map teacherId -> teacher_id for DB
        const payload = { code: subject.code, name: subject.name, program: subject.program, semester: subject.semester, teacher_id: (subject as any).teacher_id ?? subject.teacherId };
        const { data, error } = await supabase.from('subjects').insert(payload).select().single();
        if (error) throw error;
        // map returned row to Subject
        const s: Subject = { id: data.id, code: data.code, name: data.name, program: data.program, semester: data.semester, teacherId: data.teacher_id };
        setSubjects(prev => [s, ...prev]);
        setNextSubjectId(prev => Math.max(prev, s.id + 1));
        return;
      } catch (err) { console.error('addSubject supabase error', err); }
    }
    const s: Subject = { ...subject, id: nextSubjectId } as Subject;
    setSubjects(prev => [s, ...prev]);
    setNextSubjectId(prev => prev + 1);
  }

  async function updateSubject(updated: Subject) {
    if (supabase) {
      try {
        const payload = { name: updated.name, code: updated.code, program: updated.program, semester: updated.semester, teacher_id: updated.teacherId };
        const { data, error } = await supabase.from('subjects').update(payload).eq('id', updated.id).select().single();
        if (!error && data) {
          const mapped: Subject = { id: data.id, code: data.code, name: data.name, program: data.program, semester: data.semester, teacherId: data.teacher_id };
          setSubjects(prev => prev.map(s => s.id === updated.id ? mapped : s));
        }
        return;
      } catch (err) { console.error('updateSubject supabase error', err); }
    }
    setSubjects(prev => prev.map(s => s.id === updated.id ? updated : s));
  }

  async function deleteSubject(id: number) {
    if (supabase) {
      try {
        const { error } = await supabase.from('subjects').delete().eq('id', id);
        if (error) throw error;
        setSubjects(prev => prev.filter(s => s.id !== id));
        return;
      } catch (err) { console.error('deleteSubject supabase error', err); }
    }
    setSubjects(prev => prev.filter(s => s.id !== id));
  }

  // Student form (submission) — uses Supabase when available
  async function submitStudentFeedback(studentId: number, program: Program, semester: Semester, isAnonymous: boolean, items: FeedbackItem[]) {
    if (!supabase) {
      console.error('submitStudentFeedback: no supabase client (supabase is null)');
      return { success: false, error: 'no_supabase_client' };
    }

    if (!items || items.length === 0) {
      console.error('submitStudentFeedback: no items to submit', { items });
      return { success: false, error: 'no_items' };
    }

    // prevent double submits by tracking a simple flag
    try {
      console.log('submitStudentFeedback: start', { studentId, program, semester, isAnonymous, items });

      let authUser: any = null;
      try {
        const authRes = await (supabase as any).auth.getUser();
        authUser = authRes?.data?.user?.id ?? null;
      } catch (e) {
        console.warn('auth.getUser() failed (ok if not using auth yet):', e);
      }

      const insertObj: any = {
      // keep auth_user for real Supabase-auth UUIDs; otherwise set NULL
      auth_user: authUser ?? null,
      // store numeric local student id in student_id column
  student_id: authUser ? null : studentId,
  program,
  semester,
  is_anonymous: !!isAnonymous
};


      console.log('Creating submission row:', insertObj);
      const { data: subData, error: subErr } = await supabase.from('submissions').insert(insertObj).select().single();
      if (subErr) {
        console.error('submissions.insert error', subErr);
        return { success: false, error: subErr };
      }
      console.log('Submission created:', subData);

      const submissionId = (subData as any).id;
      if (!submissionId) {
        console.error('No submission id returned', subData);
        return { success: false, error: 'no_submission_id' };
      }

      const rows = items.map(it => ({
        submission_id: submissionId,
        subject_id: it.subjectId,
        rating: it.rating,
        comment: it.comment ?? null
      }));
      console.log('Inserting feedback_items rows:', rows);

      const { data: itemsData, error: itemsErr } = await supabase.from('feedback_items').insert(rows).select();
      if (itemsErr) {
        console.error('feedback_items.insert error', itemsErr);
        return { success: false, error: itemsErr };
      }
      console.log('feedback_items inserted:', itemsData);

      // refresh local state
      await loadFromSupabase();
      return { success: true, submission: subData, feedback_items: itemsData };
    } catch (err) {
      console.error('submitStudentFeedback unexpected error', err);
      return { success: false, error: err };
    }
  }

  // Subject management (local helpers kept for fallback)
  function addSubjectLocal(subject: Omit<Subject, 'id'>) {
    const s: Subject = { ...subject, id: nextSubjectId };
    setSubjects(prev => [s, ...prev]);
    setNextSubjectId(prev => prev + 1);
  }
  function updateSubjectLocal(updated: Subject) {
    setSubjects(prev => prev.map(s => s.id === updated.id ? updated : s));
  }
  function deleteSubjectLocal(id: number) {
    setSubjects(prev => prev.filter(s => s.id !== id));
  }

  // Student form component
  function StudentForm({ student }: { student: User }){
    const semOptions: Semester[] = ['I','II','III','IV'];
    const [selectedSemester, setSelectedSemester] = useState<Semester>(student.semester);

    // make subjList stable
    const subjList = useMemo(() => subjectsFor(student.program, selectedSemester), [subjects, student.program, selectedSemester]);

    // memoize existing submission for this student+program+semester
    const existing = useMemo(() => {
      return submissions.find(s => s.studentId === student.id && s.program === student.program && s.semester === selectedSemester) ?? null;
    }, [submissions, student.id, student.program, selectedSemester]);

    const initialItems = useMemo<FeedbackItem[]>(() => subjList.map(s => ({ subjectId: s.id, rating: 0, comment: '' })), [subjList]);

    const [items, setItems] = useState<FeedbackItem[]>(initialItems);
    const [isAnonymous, setIsAnonymous] = useState<boolean>(anonymousAllowed);
    const [error, setError] = useState<string | null>(null);
    const [submitted, setSubmitted] = useState<boolean>(!!existing);

    // sync items/isAnonymous/submitted only when real primitives change
    useEffect(() => {
      if (existing) {
        const merged = subjList.map(s => {
          const found = (existing.items || []).find(it => it.subjectId === s.id);
          return found ? { ...found } : { subjectId: s.id, rating: 0, comment: '' };
        });
        setItems(merged);
        setIsAnonymous(!!existing.isAnonymous);
        setSubmitted(true);
      } else {
        setItems(subjList.map(s => ({ subjectId: s.id, rating: 0, comment: '' })));
        setIsAnonymous(anonymousAllowed);
        setSubmitted(false);
      }
    // stable deps: primitive keys only (existing?.id is a primitive) and subjList.length
    }, [selectedSemester, existing?.id, subjList.length, anonymousAllowed]);

    useEffect(() => { setSelectedSemester(student.semester); }, [student.id]);

    function setRating(subjectId: number, rating: number){
      if (submitted && !allowEditUntilSubmit) return;
      setItems(prev => {
        const found = prev.find(it => it.subjectId === subjectId);
        if (found) return prev.map(it => it.subjectId === subjectId ? { ...it, rating } : it);
        return [...prev, { subjectId, rating, comment: '' }];
      });
    }
    function setComment(subjectId:number, comment:string){
      if (submitted && !allowEditUntilSubmit) return;
      setItems(prev => {
        const found = prev.find(it => it.subjectId === subjectId);
        if (found) return prev.map(it => it.subjectId === subjectId ? { ...it, comment } : it);
        return [...prev, { subjectId, rating: 0, comment }];
      });
    }

    function validateAndSubmit(){
      setError(null);
      const missing = items.filter(it => it.rating < 1);
      if (missing.length > 0){ setError(`Please rate all ${items.length} subjects before submitting. ${missing.length} remaining.`); return; }
      // attempt to submit to supabase if available
      submitStudentFeedback(student.id, student.program, selectedSemester, isAnonymous, items).then(res => {
        if (res && res.success) setSubmitted(true);
        else setError('Submission failed. See console for details.');
      });
    }

    function exportMySubmission(){
      if (!submitted) return;
      const my = submissions.find(s => s.studentId === student.id && s.program === student.program && s.semester === selectedSemester);
      if (!my) return;
      const rows: string[][] = [["Subject Code","Subject Name","Rating","Comment"]];
      for (const it of my.items){ const subj = subjects.find(s => s.id === it.subjectId); rows.push([subj?.code || String(it.subjectId), subj?.name || '', String(it.rating), it.comment || '']); }
      exportCSVRows(rows, `submission_student_${student.id}_sem_${selectedSemester}.csv`);
    }

    return (
      <div className="p-4 rounded shadow bg-white/80 dark:bg-gray-800">
        <div className="flex items-center justify-between mb-4">
          <div>
            <div className="font-semibold">{student.name} — {student.program}</div>
            <div className="text-xs opacity-70">Choose semester and complete ratings (5 → 1)</div>
          </div>
          <div className="flex items-center gap-2">
            <label className="text-xs">Semester</label>
            <select value={selectedSemester} onChange={(e)=>setSelectedSemester(e.target.value as Semester)} className="p-1 rounded border">
              {semOptions.map(s => <option key={s} value={s}>{s}</option>)}
            </select>
            <label className="text-xs ml-2">Anonymous</label>
            <input type="checkbox" checked={isAnonymous} disabled={!anonymousAllowed || submitted} onChange={(e)=>setIsAnonymous(e.target.checked)} />
          </div>
        </div>

        <div className="space-y-3">
          {subjList.map(s => {
            const it = items.find(x => x.subjectId === s.id) || { subjectId: s.id, rating: 0, comment: '' };
            return (
              <div key={s.id} className="p-3 rounded border bg-white">
                <div className="flex items-center justify-between">
                  <div>
                    <div className="font-medium">{s.name} <span className="text-xs opacity-60">({s.code})</span></div>
                    <div className="text-xs opacity-60">Teacher ID: {s.teacherId}</div>
                  </div>
                  <div className="flex items-center gap-1">
                    {[5,4,3,2,1].map(r => (
                      <button key={r} onClick={()=>setRating(s.id, r)} disabled={submitted && !allowEditUntilSubmit} className={`px-2 py-1 rounded ${it.rating===r? 'font-bold':''}`}>{r}★</button>
                    ))}
                  </div>
                </div>
                <div className="mt-2">
                  <textarea rows={3} value={it.comment} onChange={(e)=>setComment(s.id, e.target.value)} disabled={submitted && !allowEditUntilSubmit} placeholder="Optional comment" className="w-full p-3 rounded border min-h-[64px]" />
                </div>
              </div>
            );
          })}
        </div>

        {error && <div className="mt-3 text-sm text-red-600">{error}</div>}

        
        <div className="mt-4 flex flex-col sm:flex-row gap-2">
  <button
    disabled={submitted && !allowEditUntilSubmit}
    onClick={validateAndSubmit}
    className={`w-full sm:w-auto px-4 py-2 rounded ${submitted? 'opacity-50 border':'bg-indigo-600 text-white'}`}
  >
    {submitted? 'Submitted' : 'Submit Final'}
  </button>

  <button
    onClick={()=>{
      localStorage.setItem(`draft-${student.id}-${student.program}-${selectedSemester}`, JSON.stringify(items));
      setReminderLogs(prev => [`Draft saved for ${student.name} sem ${selectedSemester} at ${new Date().toLocaleString()}`, ...prev]);
    }}
    className="w-full sm:w-auto px-3 py-2 rounded border"
  >
    Save Draft
  </button>

  <button onClick={exportMySubmission} disabled={!submitted} className="w-full sm:w-auto px-3 py-2 rounded border">
    Export my submission (CSV)
  </button>
</div>

      </div>
    );
  }

  // Admin panel
  function AdminPanel(){
    const totalSubmissions = submissions.length;
    const ratingCounts = [1,2,3,4,5].map(r => ({ rating: String(r), count: submissions.reduce((acc, sub) => acc + sub.items.filter(it => it.rating === r).length, 0) }));

    // subject management UI state
    const [newSubjectName, setNewSubjectName] = useState<string>("");
    const [newSubjectCode, setNewSubjectCode] = useState<string>("");
    const [newProgram, setNewProgram] = useState<Program>("MBA");
    const [newSemester, setNewSemester] = useState<Semester>("I");

    // summary selectors
    const [summaryProgram, setSummaryProgram] = useState<Program>("MBA");
    const [summarySemester, setSummarySemester] = useState<Semester>("I");

    async function handleAddSubject(){
      if (!newSubjectName.trim()) return;
      const payload = { code: newSubjectCode || `${newProgram[0]}${newSemester}${nextSubjectId}`, name: newSubjectName.trim(), program: newProgram, semester: newSemester, teacherId: 10 } as any;
      await addSubject(payload as any);
      setNewSubjectName(''); setNewSubjectCode('');
    }

    const subjectsForSummary = subjects.filter(s => s.program === summaryProgram && s.semester === summarySemester);
    const subjectSummaries = subjectsForSummary.map(s => {
      const itemsForSubject = submissions.flatMap(sub => sub.items.filter(it => it.subjectId === s.id && sub.program === summaryProgram && sub.semester === summarySemester));
      const avg = itemsForSubject.length === 0 ? 0 : (itemsForSubject.reduce((a,b)=>a+b.rating,0) / itemsForSubject.length);
      const count = itemsForSubject.length;
      const comments = submissions.flatMap(sub => sub.items.filter(it => it.subjectId === s.id && it.comment).map(it => ({ comment: it.comment, submittedAt: sub.submittedAt }))).slice(0,50);
      return { subject: s, avg, count, comments };
    });

    return (
      <div className="space-y-4">
        <div className="p-4 rounded shadow bg-white/80 dark:bg-gray-800">
          <div className="flex items-center justify-between">
            <div>
              <div className="text-xs opacity-70">Total submissions (all time)</div>
              <div className="text-2xl font-semibold">{totalSubmissions}</div>
            </div>
            <div className="flex gap-2">
              <button onClick={()=>setReminderLogs(prev=>[`Reminder sent to all students at ${new Date().toLocaleString()}`, ...prev])} className="px-3 py-1 rounded bg-green-600 text-white">Send Reminders (simulate)</button>
              <button onClick={()=>{
                const rows = [["SubmissionID","StudentID","Program","Semester","SubjectCode","SubjectName","Rating","Comment","SubmittedAt"]];
                for (const sub of submissions){ for (const it of sub.items){ const subj = subjects.find(s => s.id === it.subjectId); rows.push([String(sub.id), String(sub.studentId), sub.program, sub.semester, subj?.code || String(it.subjectId), subj?.name || '', String(it.rating), it.comment || '', sub.submittedAt]); }}
                exportCSVRows(rows, `all_submissions_${new Date().toISOString().slice(0,10)}.csv`);
              }} className="px-3 py-1 rounded border">Export CSV</button>
            </div>
          </div>
        </div>

        {/* Subject management */}
        <div className="p-4 rounded shadow bg-white/80 dark:bg-gray-800">
          <h4 className="font-medium mb-2">Manage subjects</h4>
          <div className="grid grid-cols-1 sm:grid-cols-3 gap-2">
            <input value={newSubjectName} onChange={(e)=>setNewSubjectName(e.target.value)} placeholder="Subject name" className="p-2 rounded border" />
            <input value={newSubjectCode} onChange={(e)=>setNewSubjectCode(e.target.value)} placeholder="Subject code (optional)" className="p-2 rounded border" />
            <select value={newProgram} onChange={(e)=>setNewProgram(e.target.value as Program)} className="p-2 rounded border"><option>MBA</option><option>MCA</option></select>
            <select value={newSemester} onChange={(e)=>setNewSemester(e.target.value as Semester)} className="p-2 rounded border"><option>I</option><option>II</option><option>III</option><option>IV</option></select>
            <button onClick={handleAddSubject} className="px-3 py-2 rounded bg-indigo-600 text-white">Add subject</button>
          </div>

          <div className="mt-4">
            <h5 className="font-medium">Current subjects (recent first)</h5>
            <div className="mt-2 space-y-2 text-sm">
              {subjects.slice(0,50).map(s => (
                <div key={s.id} className="p-2 border rounded flex items-center justify-between">
                  <div>{s.code} — {s.name} <span className="text-xs opacity-60">({s.program} Sem {s.semester})</span></div>
                  <div className="flex gap-2">
                    <button onClick={async ()=>{
                      const updatedName = prompt('Edit subject name', s.name) || s.name;
                      const updatedCode = prompt('Edit code', s.code) || s.code;
                      await updateSubject({ ...s, name: updatedName, code: updatedCode });
                    }} className="px-2 py-1 rounded border">Edit</button>
                    <button onClick={async ()=>{ if (confirm(`Delete subject ${s.name}? This will not delete past submissions.`)) await deleteSubject(s.id); }} className="px-2 py-1 rounded border">Delete</button>
                  </div>
                </div>
              ))}
            </div>
          </div>
        </div>

        {/* Summary: select program & semester */}
        <div className="p-4 rounded shadow bg-white/80 dark:bg-gray-800">
          <h4 className="font-medium mb-2">Subject-wise summary (semester)</h4>
          <div className="flex gap-2 items-center mb-4">
            <label className="text-xs">Program</label>
            <select value={summaryProgram} onChange={(e)=>setSummaryProgram(e.target.value as Program)} className="p-1 rounded border"><option>MBA</option><option>MCA</option></select>
            <label className="text-xs">Semester</label>
            <select value={summarySemester} onChange={(e)=>setSummarySemester(e.target.value as Semester)} className="p-1 rounded border"><option>I</option><option>II</option><option>III</option><option>IV</option></select>
            <button onClick={()=>{
              const rows = [["SubjectCode","SubjectName","AverageRating","ResponseCount"]];
              for (const ss of subjectSummaries){ rows.push([ss.subject.code, ss.subject.name, ss.avg.toFixed(2), String(ss.count)]); }
              exportCSVRows(rows, `summary_${summaryProgram}_sem_${summarySemester}.csv`);
            }} className="px-2 py-1 rounded border ml-auto">Export summary CSV</button>
          </div>

          <div>
            {subjectSummaries.length === 0 ? <div className="text-xs opacity-60">No subjects for selected program/semester.</div> : (
              <div className="space-y-3">
                {subjectSummaries.map(ss => (
                  <div key={ss.subject.id} className="p-2 border rounded">
                    <div className="flex items-center justify-between">
                      <div>
                        <div className="font-semibold">{ss.subject.code} — {ss.subject.name}</div>
                        <div className="text-xs opacity-60">Responses: {ss.count} • Average: {ss.avg.toFixed(2)}</div>
                      </div>
                      <div>
                        <button onClick={()=>{
                          if (ss.comments.length===0) alert('No comments for this subject.');
                          else alert(ss.comments.map(c=>`${new Date(c.submittedAt).toLocaleString()}: ${c.comment}`).join('\n'));
                        }} className="px-2 py-1 rounded border">View comments</button>
                      </div>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>
        </div>

        {/* Ratings distribution */}
        <div className="p-4 rounded shadow bg-white/80 dark:bg-gray-800">
          <h4 className="font-medium mb-2">Ratings distribution (all submissions)</h4>
          <div style={{ minHeight: 220, width: '100%' }}>
            <ResponsiveContainer width="100%" height="100%">
              <BarChart data={ratingCounts}>
                <XAxis dataKey="rating" />
                <YAxis allowDecimals={false} />
                <Tooltip />
                <Bar dataKey="count" />
              </BarChart>
            </ResponsiveContainer>
          </div>
        </div>

        <div className="p-4 rounded shadow bg-white/80 dark:bg-gray-800">
          <h4 className="font-medium">Reminder logs</h4>
          <div className="mt-2 space-y-1 text-sm opacity-80">
            {reminderLogs.length === 0 ? <div className="text-xs opacity-60">No reminders sent yet.</div> : reminderLogs.map((m, i) => <div key={i}>{m}</div>)}
          </div>
        </div>
      </div>
    );
  }

  // Teacher panel
  function TeacherPanel({ teacher }: { teacher: User }){
    const taught = subjects.filter(s => s.teacherId === teacher.id);
    return (
      <div className="space-y-4">
        <div className="p-4 rounded shadow bg-white/80 dark:bg-gray-800">
          <div className="font-semibold">{teacher.name} — Courses taught</div>
          <ul className="mt-2 list-disc list-inside">
            {taught.length === 0 ? <li className="text-xs opacity-60">No courses assigned in demo</li> : taught.slice(0,10).map(s => <li key={s.id}>{s.name} ({s.code})</li>)}
          </ul>
        </div>

        <div className="p-4 rounded shadow bg-white/80 dark:bg-gray-800">
          <h4 className="font-medium">Recent feedback snippets (anon)</h4>
          <div className="mt-2 space-y-2 text-sm opacity-80">
            {submissions.slice(0,5).map(sub => (
              <div key={sub.id} className="p-2 border rounded">From: {sub.isAnonymous ? 'Anonymous' : `Student ${sub.studentId}`} • {new Date(sub.submittedAt).toLocaleString()}</div>
            ))}
          </div>
        </div>
      </div>
    );
  }

  // Main render
  return (
    <div className={"min-h-screen p-6 " + (dark? 'bg-gray-900 text-gray-100':'bg-gray-50 text-gray-900')}>
      <header className="max-w-7xl mx-auto flex items-center justify-between mb-6">
        <div>
          <h1 className="text-2xl font-bold">Student Feedback Monitor — Demo</h1>
          <p className="text-sm opacity-70">Single-form semester feedback • Anonymous allowed • Final-submit lock</p>
        </div>

        {/* Role switcher + dark mode */}
        <div className="flex items-center gap-3">
          <label className="text-sm">Role:</label>
          <select value={currentRole} onChange={(e) => setCurrentRole(e.target.value as Role)} className="p-2 rounded border">
            <option>Admin</option>
            <option>Teacher</option>
            <option>Student</option>
            <option>Coordinator</option>
          </select>
          <div className="text-sm opacity-70">Signed in as: {currentUser.name}</div>
          <button onClick={()=>setDark(d=>!d)} className="px-3 py-1 rounded border ml-2">{dark? 'Light':'Dark'}</button>
        </div>
      </header>

      <main className="max-w-5xl md:max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 grid grid-cols-1 md:grid-cols-3 gap-6">
        <section className="col-span-1 space-y-4">
          {currentRole === 'Admin' && <AdminPanel />}
          {currentRole === 'Teacher' && <TeacherPanel teacher={currentUser} />}
          {currentRole === 'Coordinator' && <AdminPanel />}
        </section>

        <section className="col-span-2">
          {currentRole === 'Student' ? (
            <StudentForm student={currentUser} />
          ) : (
            <div className={"p-4 rounded shadow " + (dark? 'bg-gray-800':'bg-white/80') }>
              <div className="font-medium mb-2">Demo actions</div>
              <div className="text-sm opacity-70">Switch to <strong>Student</strong> role to fill the semester form. Use Admin to simulate reminders and see aggregated charts.</div>

              <div className="mt-4">
                <h4 className="font-semibold">Quick stats</h4>
                <div className="mt-2 grid grid-cols-1 sm:grid-cols-2 gap-3">
                  <div className="p-3 rounded border">
                    <div className="text-xs opacity-70">Total Submissions</div>
                    <div className="text-xl font-semibold">{submissions.length}</div>
                  </div>
                  <div className="p-3 rounded border">
                    <div className="text-xs opacity-70">Distinct Subjects</div>
                    <div className="text-xl font-semibold">{subjects.length}</div>
                  </div>
                </div>
              </div>

              <div className="mt-4">
                <h4 className="font-semibold">Demo configuration</h4>
                <div className="mt-2 space-y-2 text-sm">
                  <label><input type="checkbox" checked={anonymousAllowed} onChange={(e)=>setAnonymousAllowed(e.target.checked)} /> Allow anonymous submissions (admin setting)</label>
                  <label><input type="checkbox" checked={!allowEditUntilSubmit} onChange={(e)=>setAllowEditUntilSubmit(!e.target.checked)} /> Disable edits after submit</label>
                </div>
              </div>
            </div>
          )}

          <div className={"mt-4 p-4 rounded shadow " + (dark? 'bg-gray-800':'bg-white/80') }>
            <h4 className="font-medium mb-2">Recent submissions</h4>
            <div className="space-y-2 text-sm opacity-80">
              {submissions.slice(0,10).map(sub => (
                <div key={sub.id} className="p-2 border rounded">
                  <div><strong>{sub.isAnonymous ? 'Anonymous' : `Student ${sub.studentId}`}</strong> • {sub.program} Sem {sub.semester} • {new Date(sub.submittedAt).toLocaleString()}</div>
                  <div className="text-xs opacity-70">{sub.items.length} items</div>
                </div>
              ))}
              {submissions.length === 0 && <div className="text-xs opacity-60">No submissions yet.</div>}
            </div>
          </div>
        </section>
      </main>

      <footer className={"max-w-7xl mx-auto mt-8 text-xs " + (dark? 'opacity-40':'opacity-60')}>This is a demo UI. To make this production-ready we will wire real auth (SSO / LDAP), database (Postgres / Firebase), and email/SMS reminder queues.</footer>
    </div>
  );
}
