// Integrity against accidental modification, not a signature or remote attestation.
export async function readPracticeReport(envelope, expected) {
 if(envelope?.schema!=='mayak-practice-envelope-v1'||typeof envelope.payload!=='string'||envelope.payload.length>500000)throw Error('Неподходящий формат отчёта практики.');
 const bytes=await crypto.subtle.digest('SHA-256',new TextEncoder().encode(envelope.payload));
 const hash=Array.from(new Uint8Array(bytes),x=>x.toString(16).padStart(2,'0')).join('');
 if(hash!==envelope.sha256)throw Error('Контрольная сумма отчёта не совпала.');
 const r=JSON.parse(envelope.payload);
 if(r.schema!=='mayak-practice-report-v1'||r.lesson!==expected.lesson||!/^[a-f0-9]{32}$/.test(r.attempt)||!/^[a-f0-9]{64}$/.test(r.guest)||!r.environment?.kernel||typeof r.observations!=='string'||typeof r.passed!=='boolean'||![0,1].includes(r.variant)||!Number.isFinite(r.started)||!Number.isFinite(r.checked)||r.started<=0||r.checked<=0)throw Error('Поля отчёта не соответствуют работе.');
 // Guest and browser clocks may differ (especially in the time lesson).
 // The browser-issued attempt ID binds the run; wall-clock order is not a proof.
 const fresh=r.runnerSha256===expected.runnerSha256&&r.attempt===expected.attempt&&r.variant===expected.variant;
 const clockWarning=r.checked<r.started||Math.abs(r.checked*1000-Date.now())>300000;
 return {report:r,fresh,verified:fresh&&r.passed,clockWarning};
}
