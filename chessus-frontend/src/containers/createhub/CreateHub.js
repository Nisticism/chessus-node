import React from "react";
import { FaChessKnight, FaChessBishop } from "react-icons/fa";
import HubGrid from "../../components/hub/HubGrid";

const CreateHub = () => {
  const creationOptions = [
    {
      title: "New Game",
      description: "Create your own custom strategy game with unique rules, board layouts, and winning conditions. Define how pieces move, capture, and interact.",
      link: "/create/game",
      icon: "🎲",
    },
    {
      title: "New Piece",
      description: "Build custom pieces with your own movement patterns, capture rules, and special abilities. Upload graphics and define unique behaviors.",
      link: "/create/piece",
      icon: <FaChessKnight color="#cbd5e1" />,
    },
    {
      title: "Game Library",
      description: "Browse all custom games created by the GridGrove community. Discover new game types and find inspiration for your own creations.",
      link: "/create/games",
      icon: "📚",
    },
    {
      title: "Piece Library",
      description: "Explore the collection of custom pieces designed by the community. See piece images, movement patterns, and find pieces for your games.",
      link: "/create/pieces",
      icon: <FaChessBishop color="#cbd5e1" />,
    },
  ];

  return (
    <HubGrid
      title="Create"
      subtitle="Design custom games and pieces, or explore what the community has created"
      options={creationOptions}
    />
  );
};

export default CreateHub;