# Map follow after preview failure

The planner chained drawRoutePreview and recenter in one try/catch. If drawing
failed, follow mode was never requested. If recenter failed, the UI incorrectly
reported a route-preview failure. A device screenshot showed this message while
the driver reported a stuck map; it does not establish which native call failed.

The two operations now have independent failure handling. Preview failure does
not suppress the follow command. Each failure is identified accurately. A later
successful update clears the old error. Cleanup still prevents stale follow calls
after unmount or a superseding route update. No guidance, profile, permissions,
GPS accuracy filters, route restrictions or native SDK APIs changed.

Regression cases cover preview failure with follow success, follow failure with
preview success, recovery after both failures, and unmount during a failed preview.
Licensed SDK compilation and the full mobile suite run in the candidate workflow.
Physical GPS updates, map following, background/resume behavior and active
turn-by-turn guidance still require Android acceptance; this corrects a confirmed
control-flow defect, not every possible cause of a stationary marker.
