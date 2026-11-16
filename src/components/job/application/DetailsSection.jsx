import Field from "./Field.jsx";

export default function DetailsSection({ jobId, application, onUpdated }) {
  return (
    <div className="section">
      <div className="section-title">Details</div>
      <div className="form-grid">
        <Field jobId={jobId} name="nextAction" label="Next action" value={application?.next_action || ""} placeholder="Follow up" onSaved={onUpdated} />
        <Field jobId={jobId} name="nextActionAt" label="Next action date" type="date" value={application?.next_action_at || ""} onSaved={onUpdated} />
        <Field jobId={jobId} name="salaryExpectation" label="Salary expectation" value={application?.salary_expectation || ""} onSaved={onUpdated} />
      </div>
      <div className="form-grid mt-1">
        <Field jobId={jobId} name="contactName" label="Contact name" value={application?.contact_name || ""} onSaved={onUpdated} />
        <Field jobId={jobId} name="contactEmail" label="Contact email" type="email" value={application?.contact_email || ""} onSaved={onUpdated} />
        <Field jobId={jobId} name="contactLinkedin" label="Contact LinkedIn" value={application?.contact_linkedin || ""} onSaved={onUpdated} />
      </div>
    </div>
  );
}
