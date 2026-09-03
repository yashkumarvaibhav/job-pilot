const secret = process.env.CRON_SECRET;
if (typeof secret !== "string" || secret.length < 16) {
  process.stderr.write("CRON_SECRET is missing or too short.\n");
  process.exitCode = 1;
} else {
  try {
    const response = await fetch("http://127.0.0.1:8061/api/cron/tick", {
      method: "POST",
      headers: { authorization: `Bearer ${secret}` },
    });
    if (!response.ok) {
      process.stderr.write(`Job Pilot tick failed with HTTP ${response.status}.\n`);
      process.exitCode = 1;
    }
  } catch {
    process.stderr.write("Job Pilot tick could not reach the local service.\n");
    process.exitCode = 1;
  }
}
