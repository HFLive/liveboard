import { canLecture } from "@liveboard/shared";
import { EmptyState, ListRow } from "@/components/lists";
import { BodyText, GhostButton, Screen } from "@/components/ui";
import {
  getFolderTree,
  listFiles,
  uploadStandaloneAsset,
  type FileSummary,
  type FolderAssetSummary,
  type FolderNode,
  type LocalUploadFile,
} from "@/lib/api";
import { useSession } from "@/lib/session/SessionProvider";
import * as DocumentPicker from "expo-document-picker";
import { router, useFocusEffect } from "expo-router";
import { useCallback, useMemo, useState } from "react";
import { ActivityIndicator } from "react-native";

export default function ContentScreen() {
  const { notify } = useSession();
  const [tree, setTree] = useState<FolderNode[] | null>(null);
  const [folderId, setFolderId] = useState<string | null>(null);
  const [files, setFiles] = useState<FileSummary[]>([]);
  const [assets, setAssets] = useState<FolderAssetSummary[]>([]);
  const [loading, setLoading] = useState(true);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const [folders, listing] = await Promise.all([
        getFolderTree(),
        listFiles(folderId ?? undefined),
      ]);
      setTree(folders.folders);
      setFiles(listing.files);
      setAssets(listing.standaloneAssets);
    } catch (caught) {
      notify(caught instanceof Error ? caught.message : "无法加载文档");
    } finally {
      setLoading(false);
    }
  }, [folderId, notify]);

  useFocusEffect(
    useCallback(() => {
      void load();
    }, [load]),
  );

  const current = useMemo(
    () => (folderId ? findFolder(tree ?? [], folderId) : null),
    [folderId, tree],
  );
  const children = current ? current.children : (tree ?? []);
  const canUpload = Boolean(current && canLecture(current.permission));

  async function pickAndUpload() {
    if (!current) return;
    const picked = await DocumentPicker.getDocumentAsync({
      copyToCacheDirectory: true,
      multiple: false,
    });
    if (picked.canceled || !picked.assets[0]) return;
    const asset = picked.assets[0];
    const file: LocalUploadFile = {
      uri: asset.uri,
      name: asset.name,
      mimeType: asset.mimeType ?? "application/octet-stream",
      size: asset.size ?? 0,
    };
    try {
      await uploadStandaloneAsset(current.id, file);
      notify("已上传", "success");
      await load();
    } catch (caught) {
      notify(caught instanceof Error ? caught.message : "上传失败");
    }
  }

  if (loading && !tree) {
    return (
      <Screen scroll={false}>
        <ActivityIndicator />
      </Screen>
    );
  }

  return (
    <Screen>
      {folderId ? (
        <>
          <GhostButton
            label="返回上一级"
            onPress={() => setFolderId(current?.parentId ?? null)}
          />
          {current ? <BodyText muted>{current.name}</BodyText> : null}
        </>
      ) : null}
      {children.map((folder) => (
        <ListRow
          key={folder.id}
          onPress={() => setFolderId(folder.id)}
          subtitle={`${folder.fileCount} 个文档`}
          title={folder.name}
        />
      ))}
      {files.map((file) => (
        <ListRow
          key={file.id}
          meta={file.status === "draft" ? "草稿" : undefined}
          onPress={() =>
            router.push({ pathname: "/document/[id]", params: { id: file.id } })
          }
          subtitle={new Date(file.updatedAt).toLocaleString()}
          title={file.title}
        />
      ))}
      {assets.map((asset) => (
        <ListRow
          key={asset.id}
          onPress={() =>
            router.push({
              pathname: "/preview",
              params: {
                kind: "asset",
                id: asset.id,
                title: asset.filename,
                mimeType: asset.mimeType,
              },
            })
          }
          subtitle={`${Math.ceil(asset.sizeBytes / 1024)} KB`}
          title={asset.filename}
        />
      ))}
      {canUpload ? (
        <GhostButton label="上传文件" onPress={() => void pickAndUpload()} />
      ) : null}
      {children.length + files.length + assets.length === 0 ? (
        <EmptyState title="这个位置还没有内容" />
      ) : null}
    </Screen>
  );
}

function findFolder(nodes: FolderNode[], id: string): FolderNode | null {
  for (const node of nodes) {
    if (node.id === id) return node;
    const found = findFolder(node.children, id);
    if (found) return found;
  }
  return null;
}
