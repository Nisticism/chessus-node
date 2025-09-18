import React from 'react'
import { useNavigate } from 'react-router-dom'
import StandardButton from '../standardbutton/StardardButton'

const NotFound = () => {

  const navigate = useNavigate();

  const handleHome = () => {
    navigate("/");
  }

  return (
    <div>
      <h1>Sorry, we couldn't find a page here!</h1>
      <StandardButton buttonText={"Return Home"} onClick={handleHome}/>
    </div>
  )
}

export default NotFound