import React from "react";
import { useSelector } from "react-redux";
import HubGrid from "../../components/hub/HubGrid";

const InfoHub = () => {
  const { changelogEnabled: showChangelog } = useSelector((state) => state.siteSettings);

  const infoOptions = [
    {
      title: "News",
      description: "Stay updated with the latest announcements, features, and community highlights.",
      icon: "📰",
      link: "/news",
    },
    {
      title: "Announcements",
      description: "Site-wide updates and important news from the GridGrove team.",
      icon: "📢",
      link: "/announcements",
    },
    {
      title: "FAQ",
      description: "Find answers to common questions about creating pieces, games, and more.",
      icon: "❓",
      link: "/faq",
    },
    {
      title: "About Us",
      description: "Learn about GridGrove, our team, and our mission.",
      icon: "ℹ️",
      link: "/community/about",
    },
    {
      title: "Contact",
      description: "Get in touch with the GridGrove team for support, feedback, or inquiries.",
      icon: "✉️",
      link: "/contact",
    },
    {
      title: "Support GridGrove",
      description: "Support GridGrove and help us grow the platform.",
      icon: "💝",
      link: "/donate",
    },
    ...(showChangelog ? [{
      title: "Changelog",
      description: "See the latest updates, features, and improvements to GridGrove.",
      icon: "📋",
      link: "/changelog",
    }] : []),
  ];

  return (
    <HubGrid
      title="Info"
      subtitle="News, help, and everything you need to know about GridGrove"
      options={infoOptions}
    />
  );
};

export default InfoHub;
