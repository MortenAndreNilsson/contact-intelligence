import type { CourseOverviewData } from "../../types/index.ts";
import { relativeDate, PeriodToggle } from "./helpers.tsx";
import type { Period } from "./helpers.tsx";

export function CoursesCard({ data, period = "all" }: { data: CourseOverviewData; period?: Period }) {
  return (
    <div>
      <PeriodToggle current={period} basePath="/analytics/courses" />

      <div class="stat-grid" style="grid-template-columns: repeat(3, 1fr)">
        <div class="stat-box">
          <div class="stat-value">{data.courses.length}</div>
          <div class="stat-label">Courses</div>
        </div>
        <div class="stat-box">
          <div class="stat-value">{data.totalEnrollments}</div>
          <div class="stat-label">Enrollments</div>
        </div>
        <div class="stat-box">
          <div class="stat-value" style={data.completionRate > 50 ? "color: var(--visma-lime)" : undefined}>
            {data.completionRate}%
          </div>
          <div class="stat-label">Completion Rate</div>
        </div>
      </div>

      {data.courses.length > 0 ? (
        <div class="card">
          <div class="card-label mb-xs">Courses by Enrollment</div>
          {data.courses.map((course) => {
            const rate = course.enrollment_count > 0
              ? Math.round((course.completion_count / course.enrollment_count) * 100)
              : 0;
            return (
              <div class="table-row">
                <div class="flex-1">
                  <div style="font-weight: 600; font-size: 0.9rem">{course.title || course.slug}</div>
                  <div class="flex gap-xs items-center" style="margin-top: 4px">
                    <span class={`badge ${rate >= 50 ? "badge-lime" : rate > 0 ? "badge-orange" : "badge-muted"}`}>
                      {rate}% completed
                    </span>
                    {course.latest_activity && (
                      <span class="text-xs text-muted">Last activity {relativeDate(course.latest_activity)}</span>
                    )}
                  </div>
                  <div class="score-bar mt-sm" style="max-width: 160px">
                    <div class="score-bar-fill" style={`width: ${rate}%`}></div>
                  </div>
                </div>
                <div style="text-align: right">
                  <div class="font-mono" style="font-size: 1.25rem; font-weight: 700; color: var(--visma-turquoise)">
                    {course.enrollment_count}
                  </div>
                  <div class="text-xs text-muted">
                    {course.completion_count} completed
                  </div>
                </div>
              </div>
            );
          })}
        </div>
      ) : (
        <div class="empty-state">
          <div class="empty-state-icon">&#9671;</div>
          <div>No course enrollments recorded{period !== "all" ? " in this period" : " yet"}. Sync courses first.</div>
        </div>
      )}
    </div>
  );
}
