import { InProcessQueue } from "./queue";
import { PrismaClient, Prisma } from "@prisma/client";
import { EpayImporter } from "./epayImporter";
import { logger } from "./logger";

export class Worker {
  private queue: InProcessQueue<string>;
  private prisma: PrismaClient;
  private importer: EpayImporter;
  private running = false;
  private sweepHandle?: NodeJS.Timeout;

  constructor(queue: InProcessQueue<string>, prisma: PrismaClient) {
    this.queue = queue;
    this.prisma = prisma;
    this.importer = new EpayImporter();

    this.queue.on("enqueued", () => this.kick());
    this.sweepHandle = setInterval(() => this.sweep(), 30_000);
  }

  private async sweep() {
    // Re-enqueue any queued batches not yet being processed
    const stale = await this.prisma.batch.findMany({
      where: { status: "Queued" },
      orderBy: { createdUtc: "asc" },
      take: 5,
    });
    for (const b of stale) {
      logger.info({ batchId: b.id }, "Sweep re-enqueue");
      this.queue.enqueue(b.id);
    }
  }

  private kick() {
    if (!this.running) {
      void this.loop();
    }
  }

  private async loop() {
    if (this.running) return;
    this.running = true;
    try {
      while (this.queue.size() > 0) {
        const id = this.queue.dequeue();
        if (!id) break;
        await this.process(id);
      }
    } finally {
      this.running = false;
    }
  }

  private async process(batchId: string) {
    logger.info({ batchId }, "Processing batch");
    await this.prisma.batch.update({ where: { id: batchId }, data: { status: "Running" } });

    const batch = await this.prisma.batch.findUnique({ where: { id: batchId } });
    if (!batch) {
      logger.error({ batchId }, "Batch not found");
      return;
    }
    try {
      const res = await this.importer.importCsv(batch.csvPath);
      const rows = res.rows ?? [];
      let expectedSites: string[] = [];
      try {
        const parsed = JSON.parse(batch.jobsJson ?? "[]");
        if (Array.isArray(parsed)) {
          expectedSites = Array.from(
            new Set(parsed.map((site) => String(site).trim()).filter(Boolean))
          );
        }
      } catch {
        expectedSites = [];
      }

      const successRows = rows.filter((r) => r.status === "Added" || r.status === "Updated");
      const errorRows = rows.filter((r) => r.status === "Error");
      const siteSpecificSuccess = successRows.filter((r) => r.siteCode).map((r) => r.siteCode);
      const siteSpecificErrors = errorRows.filter((r) => r.siteCode);
      const errorSites = siteSpecificErrors.map((r) => r.siteCode);
      const errorSiteSet = new Set(errorSites);
      const allSuccessSites = Array.from(
        new Set([
          ...siteSpecificSuccess,
          ...expectedSites.filter((site) => !errorSiteSet.has(site)),
        ])
      );
      const touchedSites = new Set([...allSuccessSites, ...errorSites]);

      const operations: Prisma.PrismaPromise<unknown>[] = [];
      const successGroups = successRows
        .filter((r) => r.siteCode)
        .reduce<Map<string, { status: string; message: string; sites: string[] }>>((map, row) => {
          const msg =
            row.message?.trim() ||
            (row.status === "Updated" ? `Employee updated for site ${row.siteCode}` : "Employee added to the site.");
          const key = `${row.status}__${msg}`;
          if (!map.has(key)) {
            map.set(key, { status: row.status, message: msg, sites: [] });
          }
          map.get(key)!.sites.push(row.siteCode!);
          return map;
        }, new Map());

      const explicitSuccessSet = new Set<string>();
      for (const group of successGroups.values()) {
        operations.push(
          this.prisma.batchItem.updateMany({
            where: { batchId, siteCode: { in: group.sites } },
            data: { status: group.status, message: group.message },
          })
        );
        group.sites.forEach((site) => explicitSuccessSet.add(site));
      }

      if (siteSpecificErrors.length > 0) {
        const grouped = siteSpecificErrors.reduce<Map<string, string[]>>((map, row) => {
          const reason = row.message?.trim() || res.message || "Import failed";
          if (!map.has(reason)) map.set(reason, []);
          map.get(reason)!.push(row.siteCode);
          return map;
        }, new Map());

        for (const [reason, sites] of grouped.entries()) {
          const errorData: Record<string, any> = { status: "Error", message: reason };
          if (res.screenshotPath) {
            errorData.screenshotPath = res.screenshotPath;
          }
          operations.push(
            this.prisma.batchItem.updateMany({
              where: { batchId, siteCode: { in: sites } },
              data: errorData,
            })
          );
        }
      }

      const generalErrorMessages = errorRows
        .filter((r) => !r.siteCode || !r.siteCode.trim())
        .map((r) => r.message?.trim())
        .filter((msg): msg is string => Boolean(msg));

      const fallbackSuccess = expectedSites.filter(
        (site) => !errorSiteSet.has(site) && !explicitSuccessSet.has(site)
      );
      if (fallbackSuccess.length > 0) {
        operations.push(
          this.prisma.batchItem.updateMany({
            where: { batchId, siteCode: { in: fallbackSuccess } },
            data: {
              status: "Added",
              message: res.message || "Employee added to the site.",
            },
          })
        );
        fallbackSuccess.forEach((site) => touchedSites.add(site));
      }

      if (touchedSites.size > 0 && touchedSites.size !== expectedSites.length) {
        operations.push(
          this.prisma.batchItem.updateMany({
            where: { batchId, siteCode: { notIn: Array.from(touchedSites) } },
            data: { status: res.ok ? "Added" : "Error", message: res.message },
          })
        );
      } else if (operations.length === 0) {
        operations.push(
          this.prisma.batchItem.updateMany({
            where: { batchId },
            data: {
              status: res.ok ? "Added" : "Error",
              message: generalErrorMessages[0] || res.message,
            },
          })
        );
      }

      const batchUpdate = this.prisma.batch.update({
        where: { id: batchId },
        data: { status: res.ok ? "Done" : "Error", outcome: res.message },
      });

      await this.prisma.$transaction([batchUpdate, ...operations]);

      if (res.ok) {
        logger.info({ batchId }, "Batch imported successfully");
      } else {
        logger.error({ batchId, screenshot: res.screenshotPath }, "Batch completed with errors");
      }
    } catch (err: any) {
      const message = String(err?.message || err);
      await this.prisma.$transaction([
        this.prisma.batch.update({
          where: { id: batchId },
          data: { status: "Error", outcome: message },
        }),
        this.prisma.batchItem.updateMany({
          where: { batchId },
          data: { status: "Error", message },
        }),
      ]);
      logger.error({ batchId, err: message }, "Batch failed with exception");
    }
  }
}
