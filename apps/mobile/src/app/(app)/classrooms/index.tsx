import { EmptyState, ListRow } from "@/components/lists";
import { Screen } from "@/components/ui";
import { listClassrooms, type ClassroomSummary } from "@/lib/api";
import { useSession } from "@/lib/session/SessionProvider";
import { router, useFocusEffect } from "expo-router";
import { useCallback, useState } from "react";
import { ActivityIndicator } from "react-native";

export default function ClassroomsScreen() {
  const { notify } = useSession();
  const [items, setItems] = useState<ClassroomSummary[] | null>(null);

  useFocusEffect(
    useCallback(() => {
      let active = true;
      listClassrooms()
        .then((result) => {
          if (active) setItems(result.classrooms);
        })
        .catch((caught) => {
          notify(caught instanceof Error ? caught.message : "无法加载课堂");
        });
      return () => {
        active = false;
      };
    }, [notify]),
  );

  if (!items) {
    return (
      <Screen scroll={false}>
        <ActivityIndicator />
      </Screen>
    );
  }

  return (
    <Screen>
      {items.length === 0 ? (
        <EmptyState title="还没有课堂" detail="加入课堂后会显示在这里。" />
      ) : (
        items.map((item) => (
          <ListRow
            key={item.id}
            meta={
              item.role === "teacher"
                ? "教师"
                : item.role === "administrator"
                  ? "管理"
                  : "学生"
            }
            onPress={() =>
              router.push({
                pathname: "/classroom/[id]",
                params: { id: item.id },
              })
            }
            subtitle={item.description ?? `${item.studentCount} 名学生`}
            title={item.name}
          />
        ))
      )}
    </Screen>
  );
}
