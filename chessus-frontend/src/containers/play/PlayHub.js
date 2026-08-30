import React from "react";
import { FaChessPawn } from "react-icons/fa";
import HubGrid from "../../components/hub/HubGrid";

const PlayHub = () => {
  const playOptions = [
    {
      title: "Open Games",
      description: "Browse open lobbies, join a live match, or start a new game against another player or a bot.",
      icon: <FaChessPawn color="#cbd5e1" />,
      link: "/play/games",
    },
    {
      title: "Tournaments",
      description: "Compete in organized tournaments, track brackets, and climb the standings against other players.",
      icon: "🏆",
      link: "/play/tournaments",
    },
    {
      title: "Sandbox",
      description: "Experiment freely with any game type, test positions, and try out ideas with no stakes.",
      icon: "🪣",
      link: "/sandbox",
    },
  ];

  return (
    <HubGrid
      title="Play"
      subtitle="Jump into a live match, join a tournament, or explore the community's games"
      options={playOptions}
    />
  );
};

export default PlayHub;
