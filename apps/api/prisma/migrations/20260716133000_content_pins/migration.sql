-- Add a shared ordering slot for globally pinned document folders and files.
ALTER TABLE "Folder" ADD COLUMN "pinnedOrder" INTEGER;
ALTER TABLE "File" ADD COLUMN "pinnedOrder" INTEGER;

CREATE INDEX "Folder_workspaceId_pinnedOrder_idx"
ON "Folder"("workspaceId", "pinnedOrder");

CREATE INDEX "File_workspaceId_pinnedOrder_idx"
ON "File"("workspaceId", "pinnedOrder");
