import { Injectable, Logger } from '@nestjs/common';
import { Cron } from '@nestjs/schedule';
import { unlink } from 'fs/promises';
import path from 'path';
import { PrismaService } from '../../prisma/prisma.service';

/**
 * IM 消息保留策略：历史聊天记录落库，但强制只保留 3 天。
 * 每日 03:17 清理：
 *   1. 删除 3 天前的消息；
 *   2. 这些消息引用的附件记录与物理文件一并删除；
 *   3. 无消息引用的残留附件（上传后未发送成功等）超过 3 天同样清除。
 */
const RETENTION_DAYS = 3;
const UPLOAD_ROOT = path.resolve(process.env.UPLOAD_ROOT || path.join(process.cwd(), '.uploads'));

export interface RetentionSummary {
  cutoff: string;
  messagesDeleted: number;
  attachmentsDeleted: number;
  filesRemoved: number;
  fileErrors: number;
}

@Injectable()
export class ImRetentionService {
  private readonly logger = new Logger(ImRetentionService.name);

  constructor(private readonly prisma: PrismaService) {}

  @Cron('17 3 * * *', { name: 'ImRetentionService_dailyPurge' })
  async scheduledRun(): Promise<void> {
    const summary = await this.run();
    if (summary.messagesDeleted || summary.attachmentsDeleted) {
      this.logger.log(
        `IM 保留清理：消息 ${summary.messagesDeleted} 条，附件 ${summary.attachmentsDeleted} 个` +
          `（物理文件删除 ${summary.filesRemoved}，失败 ${summary.fileErrors}）`,
      );
    }
  }

  async run(): Promise<RetentionSummary> {
    const cutoff = new Date(Date.now() - RETENTION_DAYS * 24 * 60 * 60 * 1000);

    const { messagesDeleted, attachments } = await this.prisma.withImRetention(async (tx) => {
      // 过期消息引用的附件（先取 objectKey，供物理删除）
      const referenced = await tx.message.findMany({
        where: { createdAt: { lt: cutoff }, attachmentId: { not: null } },
        select: { attachmentId: true },
      });
      const attachmentIds = [...new Set(referenced.map((m) => m.attachmentId!))];

      const files = attachmentIds.length
        ? await tx.messageAttachment.findMany({
            where: { id: { in: attachmentIds } },
            select: { id: true, objectKey: true },
          })
        : [];

      // 删消息 → 删附件记录（含超 3 天的孤儿附件；删消息后原引用附件也变为孤儿，按 id 去重）
      const msgDel = await tx.message.deleteMany({ where: { createdAt: { lt: cutoff } } });
      const orphan = await tx.messageAttachment.findMany({
        where: { createdAt: { lt: cutoff }, messages: { none: {} } },
        select: { id: true, objectKey: true },
      });
      const fileMap = new Map<string, { id: string; objectKey: string }>();
      for (const f of [...files, ...orphan]) fileMap.set(f.id, f);
      const allFiles = [...fileMap.values()];
      const attDel = allFiles.length
        ? await tx.messageAttachment.deleteMany({
            where: { id: { in: allFiles.map((f) => f.id) } },
          })
        : { count: 0 };

      return { messagesDeleted: msgDel.count, attachments: allFiles, attachmentsDeleted: attDel.count };
    });

    // 物理文件删除在事务外执行（失败不影响已提交的数据库清理）
    let filesRemoved = 0;
    let fileErrors = 0;
    for (const f of attachments) {
      try {
        await unlink(path.join(UPLOAD_ROOT, f.objectKey));
        filesRemoved++;
      } catch {
        fileErrors++; // 文件可能已不存在
      }
    }

    return {
      cutoff: cutoff.toISOString(),
      messagesDeleted,
      attachmentsDeleted: attachments.length,
      filesRemoved,
      fileErrors,
    };
  }
}
