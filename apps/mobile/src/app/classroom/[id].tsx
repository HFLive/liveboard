import { EmptyState, ListRow, Segmented } from "@/components/lists";
import { BodyText, GhostButton, Screen } from "@/components/ui";
import {
  getClassroom,
  listClassroomFiles,
  listExerciseSets,
  listTeachingDecks,
  uploadClassroomFile,
  type ClassroomDetail,
  type ClassroomFileSummary,
  type ExerciseSetSummary,
  type LocalUploadFile,
  type TeachingDeckSummary,
} from "@/lib/api";
import { useSession } from "@/lib/session/SessionProvider";
import * as DocumentPicker from "expo-document-picker";
import { router, Stack, useLocalSearchParams } from "expo-router";
import { useEffect, useState } from "react";
import { ActivityIndicator } from "react-native";

const TABS = [
  { id: "announcements", label: "公告" },
  { id: "teaching", label: "课件" },
  { id: "exercises", label: "练习" },
  { id: "files", label: "文件" },
  { id: "members", label: "成员" },
];

export default function ClassroomScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const { notify } = useSession();
  const [tab, setTab] = useState("announcements");
  const [classroom, setClassroom] = useState<ClassroomDetail | null>(null);
  const [decks, setDecks] = useState<TeachingDeckSummary[]>([]);
  const [exercises, setExercises] = useState<ExerciseSetSummary[]>([]);
  const [files, setFiles] = useState<ClassroomFileSummary[]>([]);

  useEffect(() => {
    if (!id) return;
    let active = true;
    Promise.all([
      getClassroom(id),
      listTeachingDecks(id),
      listExerciseSets(id),
      listClassroomFiles(id),
    ])
      .then(([detail, deckResult, exerciseResult, fileResult]) => {
        if (!active) return;
        setClassroom(detail.classroom);
        setDecks(deckResult.decks);
        setExercises(exerciseResult.exerciseSets);
        setFiles(fileResult.files);
      })
      .catch((caught) => {
        notify(caught instanceof Error ? caught.message : "无法加载课堂");
      });
    return () => {
      active = false;
    };
  }, [id, notify]);

  async function uploadFile() {
    if (!id) return;
    const picked = await DocumentPicker.getDocumentAsync({
      copyToCacheDirectory: true,
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
      const result = await uploadClassroomFile(id, file);
      setFiles((current) => [result.file, ...current]);
      notify("已上传", "success");
    } catch (caught) {
      notify(caught instanceof Error ? caught.message : "上传失败");
    }
  }

  if (!classroom) {
    return (
      <Screen scroll={false} safeTop={false}>
        <ActivityIndicator />
      </Screen>
    );
  }

  return (
    <Screen safeTop={false}>
      <Stack.Screen options={{ title: classroom.name }} />
      {classroom.description ? (
        <BodyText>{classroom.description}</BodyText>
      ) : null}
      <Segmented onChange={setTab} options={TABS} value={tab} />
      {tab === "announcements" ? (
        classroom.announcements.length === 0 ? (
          <EmptyState title="暂无公告" />
        ) : (
          classroom.announcements.map((item) => (
            <ListRow key={item.id} subtitle={item.content} title={item.title} />
          ))
        )
      ) : null}
      {tab === "teaching" ? (
        decks.length === 0 ? (
          <EmptyState title="暂无课件" />
        ) : (
          decks.map((deck) => (
            <ListRow
              key={deck.id}
              onPress={() =>
                router.push({ pathname: "/deck/[id]", params: { id: deck.id } })
              }
              subtitle={`${deck.itemCount} 项`}
              title={deck.title}
            />
          ))
        )
      ) : null}
      {tab === "exercises" ? (
        exercises.length === 0 ? (
          <EmptyState title="暂无练习" />
        ) : (
          exercises.map((item) => (
            <ListRow
              key={item.id}
              meta={
                item.latestScore != null ? `${item.latestScore} 分` : undefined
              }
              onPress={() =>
                router.push({
                  pathname: "/exercise/[id]",
                  params: { id: item.id },
                })
              }
              subtitle={`${item.questionCount} 道题`}
              title={item.title}
            />
          ))
        )
      ) : null}
      {tab === "files" ? (
        <>
          {classroom.canEditContent ? (
            <GhostButton
              label="上传课堂文件"
              onPress={() => void uploadFile()}
            />
          ) : null}
          {files.length === 0 ? (
            <EmptyState title="暂无课堂文件" />
          ) : (
            files.map((file) => (
              <ListRow
                key={file.id}
                onPress={() =>
                  router.push({
                    pathname: "/preview",
                    params: {
                      kind: "classroom",
                      classroomId: id,
                      id: file.id,
                      title: file.filename,
                      mimeType: file.mimeType,
                    },
                  })
                }
                subtitle={file.uploadedBy.displayName}
                title={file.filename}
              />
            ))
          )}
        </>
      ) : null}
      {tab === "members"
        ? (classroom.members ?? []).map((member) => (
            <ListRow
              key={member.user.id}
              meta={member.role === "teacher" ? "教师" : "学生"}
              title={member.user.displayName}
            />
          ))
        : null}
    </Screen>
  );
}
