import { Text, Tabs, Space } from "@mantine/core";
import { IconClockHour3 } from "@tabler/icons-react";
import RecentChanges from "@/components/common/recent-changes.tsx";
import { useParams } from "react-router-dom";
import { useGetSpaceBySlugQuery } from "@/features/space/queries/space-query.ts";

export default function SpaceHomeTabs() {
  const { spaceSlug } = useParams();
  const { data: space } = useGetSpaceBySlugQuery(spaceSlug);

  return (
    <Tabs defaultValue="recent">
      <Tabs.List>
        <Tabs.Tab value="recent" leftSection={<IconClockHour3 size={18} />}>
          <Text size="sm" fw={500}>
            Actualizados recientemente
          </Text>
        </Tabs.Tab>
      </Tabs.List>

      <Space my="md" />

      <Tabs.Panel value="recent">
        {space?.id && <RecentChanges spaceId={space.id} />}
      </Tabs.Panel>
    </Tabs>
  )
}
