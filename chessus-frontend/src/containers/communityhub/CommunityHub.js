import React from "react";
import HubGrid from "../../components/hub/HubGrid";

const CommunityHub = () => {
  const communityOptions = [
    {
      title: "Players",
      description: "Browse all registered players and view their profiles.",
      icon: "🧑‍🤝‍🧑",
      link: "/community/players",
    },
    {
      title: "Forums",
      description: "Browse all general and game-specific forum discussions in one place.",
      icon: "💬",
      link: "/forums",
    },
    {
      title: "Social Media",
      description: "Follow us on social platforms and stay connected with our community.",
      icon: "🌐",
      link: "/community/social",
    },
    {
      title: "Streams",
      description: "Watch live gameplay, tournaments, and community events.",
      icon: "📺",
      link: "/community/streams",
    },
    {
      title: "Leaderboard",
      description: "See top-ranked players and track standings across game types.",
      icon: "🏆",
      link: "/community/leaderboard",
    },
  ];

  return (
    <HubGrid
      title="Community"
      subtitle="Browse player profiles, join forum discussions, check the leaderboard, tune into streams, or connect with us on social media"
      options={communityOptions}
    />
  );
};

export default CommunityHub;
